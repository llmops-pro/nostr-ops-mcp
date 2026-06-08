import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NDKUser } from "@nostr-dev-kit/ndk";
import { z } from "zod";
import type { Config } from "../config.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  ciphertext: z
    .string()
    .min(1)
    .describe("The encrypted message payload (the `content` field of a kind:4 event)."),
  sender_pubkey: z
    .string()
    .regex(hex64)
    .describe("Author pubkey of the event (32-byte hex)."),
  version: z
    .enum(["nip44", "nip04", "auto"])
    .optional()
    .describe(
      "Encryption scheme. `auto` (default) tries NIP-44 first, falls back to NIP-04. Force a specific scheme if you know which the sender used.",
    ),
};

export function registerDecryptDm(
  server: McpServer,
  config: Config,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_decrypt_dm",
    {
      description:
        "Decrypt a single DM ciphertext using the signer's encrypt/decrypt interface. Useful when you already have a kind:4 event from elsewhere (e.g., nostr_query_events) and just need the plaintext. Auto-detects NIP-44 vs NIP-04 by default. Same NOSTR_DM_TOOLS_ENABLED gate as send/list — reading plaintext is still a confidentiality surface.",
      inputSchema,
    },
    async ({ ciphertext, sender_pubkey, version }) => {
      if (!config.NOSTR_DM_TOOLS_ENABLED) {
        await audit.record({
          tool: "nostr_decrypt_dm",
          outcome: "blocked",
          blocked_reason: "NOSTR_DM_TOOLS_ENABLED is false",
        });
        return errorResult(
          "nostr_decrypt_dm is disabled. Set NOSTR_DM_TOOLS_ENABLED=true to opt in.",
        );
      }
      if (!ndk.hasSigner()) {
        await audit.record({
          tool: "nostr_decrypt_dm",
          outcome: "blocked",
          blocked_reason: "no signer (can't decrypt without keys)",
        });
        return errorResult("No signer configured.");
      }

      const scheme = version ?? "auto";
      const inputForAudit = {
        sender_pubkey,
        ciphertext_length: ciphertext.length,
        scheme,
      };

      try {
        await ndk.ensureSignerReady();
        const sender = new NDKUser({ pubkey: sender_pubkey });
        const signer = ndk.signer!;
        let plaintext: string;
        let used_scheme: "nip44" | "nip04";
        if (scheme === "auto") {
          try {
            plaintext = await signer.decrypt(sender, ciphertext, "nip44");
            used_scheme = "nip44";
          } catch {
            plaintext = await signer.decrypt(sender, ciphertext, "nip04");
            used_scheme = "nip04";
          }
        } else {
          plaintext = await signer.decrypt(sender, ciphertext, scheme);
          used_scheme = scheme;
        }
        await audit.record({
          tool: "nostr_decrypt_dm",
          outcome: "ok",
          input: inputForAudit,
          result: { used_scheme, plaintext_length: plaintext.length },
        });
        return textResult({ plaintext, used_scheme, sender_pubkey });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_decrypt_dm",
          outcome: "error",
          input: inputForAudit,
          error: msg,
        });
        return errorResult(`nostr_decrypt_dm failed: ${msg}`);
      }
    },
  );
}
