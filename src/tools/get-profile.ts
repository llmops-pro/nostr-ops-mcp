import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decode } from "../lib/nip19.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  pubkey_or_npub: z
    .string()
    .min(1)
    .describe(
      "A pubkey to look up — either 32-byte hex (64 chars) or an npub bech32 string.",
    ),
};

function normalizeToHex(input: string): { ok: true; hex: string } | { ok: false; reason: string } {
  if (hex64.test(input)) return { ok: true, hex: input.toLowerCase() };
  if (input.startsWith("npub1")) {
    try {
      const decoded = decode(input, { allowNsecDecode: false });
      if (decoded.type !== "npub") {
        return { ok: false, reason: `expected an npub, got ${decoded.type}` };
      }
      return { ok: true, hex: decoded.pubkey_hex };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `failed to decode npub: ${msg}` };
    }
  }
  return {
    ok: false,
    reason: "input must be a 64-hex-char pubkey or an npub1... bech32 string",
  };
}

export function registerGetProfile(
  server: McpServer,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_get_profile",
    {
      description:
        "Fetch and parse a NOSTR profile (kind:0 metadata) for the given pubkey or npub. Convenience wrapper over nostr_query_events with kinds=[0], limit=1. Returns the parsed JSON content (name, about, picture, nip05, lud16, etc.) plus the source event id and timestamp. Returns `profile: null` if no kind:0 event was found for that pubkey on the configured relay pool.",
      inputSchema,
    },
    async ({ pubkey_or_npub }) => {
      const norm = normalizeToHex(pubkey_or_npub);
      if (!norm.ok) {
        await audit.record({
          tool: "nostr_get_profile",
          outcome: "error",
          input: { pubkey_or_npub_prefix: pubkey_or_npub.slice(0, 12) + "..." },
          error: norm.reason,
        });
        return errorResult(norm.reason);
      }

      try {
        const event = await ndk.ndk.fetchEvent({
          kinds: [0],
          authors: [norm.hex],
          limit: 1,
        });
        if (!event) {
          await audit.record({
            tool: "nostr_get_profile",
            outcome: "ok",
            input: { pubkey_hex: norm.hex },
            result: { found: false },
          });
          return textResult({
            pubkey_hex: norm.hex,
            profile: null,
            note: "no kind:0 metadata event found for this pubkey on the configured relays",
          });
        }
        let profile: unknown;
        try {
          profile = JSON.parse(event.content);
        } catch {
          await audit.record({
            tool: "nostr_get_profile",
            outcome: "error",
            input: { pubkey_hex: norm.hex },
            error: "kind:0 content is not valid JSON",
          });
          return errorResult(
            `kind:0 event for ${norm.hex} has non-JSON content — got ${event.content.slice(0, 80)}...`,
          );
        }
        const result = {
          pubkey_hex: norm.hex,
          event_id: event.id,
          created_at: event.created_at,
          profile,
        };
        await audit.record({
          tool: "nostr_get_profile",
          outcome: "ok",
          input: { pubkey_hex: norm.hex },
          result: { found: true, event_id: event.id },
        });
        return textResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_get_profile",
          outcome: "error",
          input: { pubkey_hex: norm.hex },
          error: msg,
        });
        return errorResult(`nostr_get_profile failed: ${msg}`);
      }
    },
  );
}
