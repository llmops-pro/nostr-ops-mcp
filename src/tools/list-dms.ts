import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NDKUser } from "@nostr-dev-kit/ndk";
import { z } from "zod";
import type { Config } from "../config.js";
import { decode } from "../lib/nip19.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  counterparty: z
    .string()
    .min(1)
    .describe("The other party in the conversation — 64-hex-char pubkey or npub bech32."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe("Max events to consider (per direction). Hard cap 200."),
  since: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Unix timestamp (seconds). Only DMs at or after this time."),
};

export function registerListDms(
  server: McpServer,
  config: Config,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_list_dms",
    {
      description:
        "Fetch + decrypt the DM thread between the configured signer and a counterparty. Pulls kind:4 events in both directions (sent and received), decrypts each via the signer's encrypt/decrypt interface (auto-selects NIP-44 or NIP-04 based on the ciphertext), and returns the thread sorted oldest-first. Decryption failures are surfaced per-event instead of failing the whole call.",
      inputSchema,
    },
    async ({ counterparty, limit, since }) => {
      // Gate: same NOSTR_DM_TOOLS_ENABLED check as send_dm, because reading also surfaces plaintext.
      if (!config.NOSTR_DM_TOOLS_ENABLED) {
        await audit.record({
          tool: "nostr_list_dms",
          outcome: "blocked",
          input: { counterparty_prefix: counterparty.slice(0, 12) + "..." },
          blocked_reason: "NOSTR_DM_TOOLS_ENABLED is false",
        });
        return errorResult(
          "nostr_list_dms is disabled. Set NOSTR_DM_TOOLS_ENABLED=true to opt in.",
        );
      }
      if (!ndk.hasSigner()) {
        await audit.record({
          tool: "nostr_list_dms",
          outcome: "blocked",
          input: { counterparty_prefix: counterparty.slice(0, 12) + "..." },
          blocked_reason: "no signer (can't decrypt without keys)",
        });
        return errorResult("No signer configured — can't decrypt DMs.");
      }

      // Normalize counterparty to hex
      let cp_hex: string;
      if (hex64.test(counterparty)) {
        cp_hex = counterparty.toLowerCase();
      } else if (counterparty.startsWith("npub1")) {
        try {
          const d = decode(counterparty, { allowNsecDecode: false });
          if (d.type !== "npub")
            return errorResult(`expected an npub, got ${d.type}`);
          cp_hex = d.pubkey_hex;
        } catch (err) {
          return errorResult(
            `failed to decode npub: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        return errorResult(
          "counterparty must be a 64-hex-char pubkey or an npub1... string",
        );
      }

      try {
        await ndk.ensureSignerReady();
        const self_hex = (await ndk.getSignerPubkeyHex()) ?? "";
        const cpUser = new NDKUser({ pubkey: cp_hex });

        // Two filters: (sent by me to cp) OR (sent by cp to me).
        const filterBase: { kinds: number[]; limit: number; since?: number } = {
          kinds: [4],
          limit,
        };
        if (since !== undefined) filterBase.since = since;
        const sent = await ndk.ndk.fetchEvents({
          ...filterBase,
          authors: [self_hex],
          "#p": [cp_hex],
        });
        const received = await ndk.ndk.fetchEvents({
          ...filterBase,
          authors: [cp_hex],
          "#p": [self_hex],
        });

        const all = [...sent, ...received].sort(
          (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0),
        );

        const signer = ndk.signer!;
        const messages = await Promise.all(
          all.map(async (e) => {
            const direction = e.pubkey === self_hex ? "outgoing" : "incoming";
            const peerForDecrypt = direction === "outgoing" ? cpUser : new NDKUser({ pubkey: e.pubkey });
            try {
              // Try NIP-44 first, fall back to NIP-04.
              let plaintext: string;
              try {
                plaintext = await signer.decrypt(peerForDecrypt, e.content, "nip44");
              } catch {
                plaintext = await signer.decrypt(peerForDecrypt, e.content, "nip04");
              }
              return {
                event_id: e.id,
                created_at: e.created_at,
                direction,
                from: e.pubkey,
                plaintext,
              };
            } catch (err) {
              return {
                event_id: e.id,
                created_at: e.created_at,
                direction,
                from: e.pubkey,
                decrypt_error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        );

        await audit.record({
          tool: "nostr_list_dms",
          outcome: "ok",
          input: { counterparty_hex: cp_hex, limit, since: since ?? null },
          result: { message_count: messages.length },
        });
        return textResult({
          counterparty: cp_hex,
          self: self_hex,
          message_count: messages.length,
          messages,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_list_dms",
          outcome: "error",
          input: { counterparty_hex: cp_hex },
          error: msg,
        });
        return errorResult(`nostr_list_dms failed: ${msg}`);
      }
    },
  );
}
