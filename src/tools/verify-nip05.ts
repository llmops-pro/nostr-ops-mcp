import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nip05 } from "nostr-tools";
import { z } from "zod";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const NIP05_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$|^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  identifier: z
    .string()
    .regex(NIP05_REGEX, "must be a NIP-05 identifier (name@domain.tld) or a bare domain")
    .describe(
      "NIP-05 identifier. Either `name@domain.tld` (e.g., `alice@getalby.com`) or a bare `domain.tld` (resolves the `_@domain.tld` root identity).",
    ),
  expected_pubkey: z
    .string()
    .regex(hex64)
    .optional()
    .describe(
      "Optional. If provided, the tool returns verified=true only when the resolved pubkey matches.",
    ),
};

export function registerVerifyNip05(server: McpServer, audit: AuditLog): void {
  server.registerTool(
    "nostr_verify_nip05",
    {
      description:
        "Verify a NIP-05 identifier resolves to the expected pubkey. Fetches `https://{domain}/.well-known/nostr.json?name={name}` and looks up `names[name]`. If `expected_pubkey` is provided, returns verified=true only if the resolved pubkey matches; otherwise returns verified=true on any successful resolution + the resolved pubkey. Also surfaces the recipient's relay hints if the well-known doc advertises them (NIP-65 outbox path).",
      inputSchema,
    },
    async ({ identifier, expected_pubkey }) => {
      try {
        const profile = await nip05.queryProfile(identifier);
        if (!profile) {
          await audit.record({
            tool: "nostr_verify_nip05",
            outcome: "ok",
            input: { identifier },
            result: { verified: false, found: false },
          });
          return textResult({
            verified: false,
            identifier,
            message:
              "NIP-05 lookup returned no profile — domain may not host a /.well-known/nostr.json, or the name is unknown there.",
          });
        }
        if (expected_pubkey) {
          const verified = profile.pubkey.toLowerCase() === expected_pubkey.toLowerCase();
          await audit.record({
            tool: "nostr_verify_nip05",
            outcome: "ok",
            input: { identifier },
            result: { verified, resolved_pubkey: profile.pubkey },
          });
          return textResult({
            verified,
            identifier,
            resolved_pubkey: profile.pubkey,
            expected_pubkey,
            relays: profile.relays,
            ...(verified
              ? {}
              : { mismatch: `resolved ${profile.pubkey} ≠ expected ${expected_pubkey}` }),
          });
        }
        await audit.record({
          tool: "nostr_verify_nip05",
          outcome: "ok",
          input: { identifier },
          result: { verified: true, resolved_pubkey: profile.pubkey },
        });
        return textResult({
          verified: true,
          identifier,
          pubkey: profile.pubkey,
          relays: profile.relays,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_verify_nip05",
          outcome: "error",
          input: { identifier },
          error: msg,
        });
        return errorResult(`nostr_verify_nip05 failed: ${msg}`);
      }
    },
  );
}
