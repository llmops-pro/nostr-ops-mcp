import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult } from "./_result.js";
import { evaluateAndPublish, type PublishDeps, type PublishParams } from "./evaluate-and-publish.js";
import { evaluateAndSendDm, type SendDmDeps } from "./send-dm.js";
import type { DmAllowlist } from "../safety/dm-allowlist.js";

const inputSchema = {
  token: z
    .string()
    .min(1)
    .describe("Confirmation token returned by a previous write tool call."),
};

export type ConfirmPublishDeps = PublishDeps & {
  dmAllowlist: DmAllowlist;
};

export function registerConfirmPublish(server: McpServer, deps: ConfirmPublishDeps): void {
  server.registerTool(
    "nostr_confirm_publish",
    {
      description:
        "Execute a previously-prepared signed publish, identified by its one-time token. Only meaningful when NOSTR_REQUIRE_CONFIRM=true, or when called after publish_metadata (which always confirms). Token is consumed (single-use); the safety pipeline (read-only, signer, kind allowlist, rate limit, dm allowlist) re-runs before signing. Dispatches to the right execute path based on which tool issued the token (publish_event variants OR send_dm).",
      inputSchema,
    },
    async ({ token }) => {
      const action = deps.confirm.consume(token);
      if (!action) {
        await deps.audit.record({
          tool: "nostr_confirm_publish",
          outcome: "blocked",
          input: { token_prefix: token.slice(0, 8) + "..." },
          blocked_reason: "token unknown or expired",
        });
        return errorResult(
          "Token is unknown or expired. Call the original publish tool again to get a fresh token.",
        );
      }

      if (action.tool === "nostr_send_dm") {
        const sendDmDeps: SendDmDeps = {
          config: deps.config,
          ndk: deps.ndk,
          audit: deps.audit,
          dmAllowlist: deps.dmAllowlist,
          rateLimiter: deps.rateLimiter,
          confirm: deps.confirm,
        };
        return evaluateAndSendDm(
          sendDmDeps,
          action.params as unknown as {
            to_pubkey: string;
            content: string;
            version?: "nip44" | "nip04";
          },
          { skipConfirmGate: true, auditTool: "nostr_confirm_publish" },
        );
      }

      // Default: publish-flavored tokens — covers publish_event / publish_text_note /
      // publish_metadata / publish_addressable_event / delete_event.
      const params = action.params as unknown as PublishParams;
      return evaluateAndPublish(deps, params, {
        skipConfirmGate: true,
        auditTool: "nostr_confirm_publish",
        extraAuditInput: { confirmed_for: action.tool },
      });
    },
  );
}
