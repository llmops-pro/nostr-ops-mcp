import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decode } from "../lib/nip19.js";
import type { Config } from "../config.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  bech32: z
    .string()
    .min(1)
    .describe(
      "A NIP-19 bech32 string (npub / nsec / note / nevent / naddr / nprofile). Decoding nsec is REFUSED by default — set NOSTR_ALLOW_NSEC_DECODE=true to opt in.",
    ),
};

export function registerDecode(
  server: McpServer,
  config: Config,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_decode",
    {
      description:
        "Decode a NIP-19 bech32-encoded identifier (npub / nsec / note / nevent / naddr / nprofile) into its raw fields. Local-only — no network call. Refuses nsec unless NOSTR_ALLOW_NSEC_DECODE=true; guards against accidentally surfacing a private key in tool output.",
      inputSchema,
    },
    async ({ bech32 }) => {
      try {
        const result = decode(bech32, {
          allowNsecDecode: config.NOSTR_ALLOW_NSEC_DECODE,
        });
        await audit.record({
          tool: "nostr_decode",
          outcome: "ok",
          input: { bech32_prefix: bech32.slice(0, 6) + "..." },
          result: { type: result.type },
        });
        return textResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_decode",
          outcome: "error",
          error: msg,
          input: { bech32_prefix: bech32.slice(0, 6) + "..." },
        });
        return errorResult(`nostr_decode failed: ${msg}`);
      }
    },
  );
}
