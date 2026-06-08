import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npubFromHex } from "../lib/nip19.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

export function registerGetPubkey(
  server: McpServer,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_get_pubkey",
    {
      description:
        "Return the configured signer's public key as hex + npub. Errors clearly if no signer is configured (server is in read-only mode). For NIP-46 signers, this blocks until the bunker handshake completes.",
    },
    async () => {
      if (!ndk.hasSigner()) {
        await audit.record({
          tool: "nostr_get_pubkey",
          outcome: "blocked",
          blocked_reason: "no signer configured (server in read-only mode)",
        });
        return errorResult(
          "No signer configured. Set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI to enable signed operations.",
        );
      }
      try {
        await ndk.ensureSignerReady();
        const pubkey_hex = await ndk.getSignerPubkeyHex();
        if (!pubkey_hex) {
          await audit.record({
            tool: "nostr_get_pubkey",
            outcome: "error",
            error: "signer.user() returned no pubkey",
          });
          return errorResult("signer.user() returned no pubkey");
        }
        const result = { pubkey_hex, npub: npubFromHex(pubkey_hex) };
        await audit.record({
          tool: "nostr_get_pubkey",
          outcome: "ok",
          result,
        });
        return textResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: "nostr_get_pubkey", outcome: "error", error: msg });
        return errorResult(`nostr_get_pubkey failed: ${msg}`);
      }
    },
  );
}
