import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encode } from "../lib/nip19.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;
const hexN = /^[0-9a-fA-F]+$/;

const inputSchema = {
  type: z
    .enum(["npub", "note", "nevent", "naddr", "nprofile"])
    .describe(
      "NIP-19 type to encode. `nsec` is intentionally not encodable through this tool — private keys must never round-trip through the agent.",
    ),
  pubkey_hex: z
    .string()
    .regex(hex64)
    .optional()
    .describe("32-byte (64 hex char) public key. Required for npub / naddr / nprofile."),
  event_id_hex: z
    .string()
    .regex(hex64)
    .optional()
    .describe("32-byte (64 hex char) event id. Required for note / nevent."),
  author_hex: z
    .string()
    .regex(hex64)
    .optional()
    .describe("Optional author pubkey for nevent."),
  kind: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Event kind. Required for naddr; optional for nevent."),
  identifier: z
    .string()
    .optional()
    .describe("Replaceable-event `d` tag value. Required for naddr."),
  relays: z
    .array(z.string())
    .optional()
    .describe("Optional relay hints (wss://...)."),
};

export function registerEncode(server: McpServer, audit: AuditLog): void {
  server.registerTool(
    "nostr_encode",
    {
      description:
        "Encode a raw NIP-19 record (npub / note / nevent / naddr / nprofile) into its bech32 form. Local-only — no network call. Does NOT support nsec encoding (private keys must not transit the agent).",
      inputSchema,
    },
    async (args) => {
      try {
        let result: string;
        switch (args.type) {
          case "npub":
            if (!args.pubkey_hex) return errorResult("npub requires pubkey_hex");
            result = encode({ type: "npub", pubkey_hex: args.pubkey_hex });
            break;
          case "note":
            if (!args.event_id_hex) return errorResult("note requires event_id_hex");
            result = encode({ type: "note", event_id_hex: args.event_id_hex });
            break;
          case "nevent":
            if (!args.event_id_hex) return errorResult("nevent requires event_id_hex");
            result = encode({
              type: "nevent",
              event_id_hex: args.event_id_hex,
              author_hex: args.author_hex,
              relays: args.relays,
              kind: args.kind,
            });
            break;
          case "naddr":
            if (!args.identifier || !args.pubkey_hex || args.kind === undefined) {
              return errorResult("naddr requires identifier, pubkey_hex, and kind");
            }
            result = encode({
              type: "naddr",
              identifier: args.identifier,
              pubkey_hex: args.pubkey_hex,
              kind: args.kind,
              relays: args.relays,
            });
            break;
          case "nprofile":
            if (!args.pubkey_hex) return errorResult("nprofile requires pubkey_hex");
            result = encode({
              type: "nprofile",
              pubkey_hex: args.pubkey_hex,
              relays: args.relays,
            });
            break;
        }
        await audit.record({
          tool: "nostr_encode",
          outcome: "ok",
          input: { type: args.type },
          result: { bech32_prefix: result.slice(0, 8) + "..." },
        });
        return textResult({ bech32: result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: "nostr_encode", outcome: "error", error: msg });
        return errorResult(`nostr_encode failed: ${msg}`);
      }
      // Unreachable — switch is exhaustive on the zod enum.
      void hexN;
    },
  );
}
