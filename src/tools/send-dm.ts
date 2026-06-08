import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NDKEvent, NDKUser } from "@nostr-dev-kit/ndk";
import { z } from "zod";
import type { Config } from "../config.js";
import { decode } from "../lib/nip19.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { DmAllowlist } from "../safety/dm-allowlist.js";
import type { RateLimiter } from "../safety/rate-limiter.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  to_pubkey: z
    .string()
    .min(1)
    .describe("Recipient — 32-byte hex pubkey OR an npub bech32 string."),
  content: z.string().min(1).describe("Plaintext message; encrypted before broadcast."),
  version: z
    .enum(["nip44", "nip04"])
    .optional()
    .describe(
      "Encryption scheme. Defaults to nip44 (current standard). NIP-04 is deprecated but widely deployed — use only if you know the recipient's client expects it.",
    ),
};

export type SendDmDeps = {
  config: Config;
  ndk: NdkClient;
  audit: AuditLog;
  dmAllowlist: DmAllowlist;
  rateLimiter: RateLimiter;
  confirm: ConfirmStore;
};

function normalizeToHex(input: string): { ok: true; hex: string } | { ok: false; reason: string } {
  if (hex64.test(input)) return { ok: true, hex: input.toLowerCase() };
  if (input.startsWith("npub1")) {
    try {
      const d = decode(input, { allowNsecDecode: false });
      if (d.type !== "npub") return { ok: false, reason: `expected an npub, got ${d.type}` };
      return { ok: true, hex: d.pubkey_hex };
    } catch (err) {
      return { ok: false, reason: `failed to decode npub: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { ok: false, reason: "to_pubkey must be a 64-hex-char pubkey or an npub1... string" };
}

export async function evaluateAndSendDm(
  deps: SendDmDeps,
  params: { to_pubkey: string; content: string; version?: "nip44" | "nip04" },
  opts: { skipConfirmGate?: boolean; auditTool?: string } = {},
) {
  const auditTool = opts.auditTool ?? "nostr_send_dm";
  const recipientNorm = normalizeToHex(params.to_pubkey);
  if (!recipientNorm.ok) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "error",
      input: { to_prefix: params.to_pubkey.slice(0, 12) + "..." },
      error: recipientNorm.reason,
    });
    return errorResult(recipientNorm.reason);
  }
  const to_hex = recipientNorm.hex;
  const scheme = params.version ?? "nip44";
  const inputForAudit = {
    to_hex,
    content_length: params.content.length,
    scheme,
  };

  if (!deps.config.NOSTR_DM_TOOLS_ENABLED) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NOSTR_DM_TOOLS_ENABLED is false — DM tools must be explicitly enabled",
    });
    return errorResult(
      "nostr_send_dm is disabled. Set NOSTR_DM_TOOLS_ENABLED=true in the env to opt in. DMs are the highest-risk write surface — recipient confidentiality + replay risk + relay caching.",
    );
  }
  if (deps.config.NOSTR_READ_ONLY) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NOSTR_READ_ONLY=true",
    });
    return errorResult("NOSTR_READ_ONLY=true — write tools are disabled");
  }
  if (!deps.ndk.hasSigner()) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "no signer configured",
    });
    return errorResult("No signer configured. Set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI.");
  }
  if (!deps.dmAllowlist.isAllowed(to_hex)) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: `recipient ${to_hex} is not in NOSTR_DM_ALLOWLIST`,
    });
    return errorResult(`recipient ${to_hex} is not in NOSTR_DM_ALLOWLIST`);
  }
  const rateCheck = deps.rateLimiter.take("dms");
  if (!rateCheck.ok) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: rateCheck.reason,
    });
    return errorResult(rateCheck.reason);
  }

  if (deps.config.NOSTR_REQUIRE_CONFIRM && !opts.skipConfirmGate) {
    const summary = `send ${scheme} DM to ${to_hex} (${params.content.length} chars)`;
    const { token, expires_at } = deps.confirm.prepare({
      tool: auditTool,
      params: params as unknown as Record<string, unknown>,
      summary,
    });
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: { confirmation_required: true, token },
    });
    return textResult({
      status: "confirmation_required",
      token,
      expires_at: new Date(expires_at).toISOString(),
      summary,
      next_step: `Call nostr_confirm_publish with token "${token}" to encrypt + send.`,
    });
  }

  try {
    await deps.ndk.ensureSignerReady();
    const recipient = new NDKUser({ pubkey: to_hex });
    const signer = deps.ndk.signer!;
    const ciphertext = await signer.encrypt(recipient, params.content, scheme);
    const event = new NDKEvent(deps.ndk.ndk, {
      kind: 4,
      content: ciphertext,
      tags: [["p", to_hex]],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: (await deps.ndk.getSignerPubkeyHex()) ?? "",
    });
    await event.sign();
    const accepted = await event.publish();
    const acceptedUrls = Array.from(accepted).map((r) => r.url);
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: {
        event_id: event.id,
        relays_accepted_count: acceptedUrls.length,
      },
    });
    return textResult({
      event_id: event.id,
      to_pubkey: to_hex,
      scheme,
      relays_accepted: acceptedUrls,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.audit.record({
      tool: auditTool,
      outcome: "error",
      input: inputForAudit,
      error: msg,
    });
    return errorResult(`${auditTool} failed: ${msg}`);
  }
}

export function registerSendDm(server: McpServer, deps: SendDmDeps): void {
  server.registerTool(
    "nostr_send_dm",
    {
      description:
        "Encrypt + send a NIP-04 (kind:4) direct message. Defaults to NIP-44 encryption (current standard); pass version=\"nip04\" only for legacy compatibility. Gated by NOSTR_DM_TOOLS_ENABLED + NOSTR_DM_ALLOWLIST + rate limit. For modern sealed DMs (NIP-17) wait for the next version.",
      inputSchema,
    },
    async ({ to_pubkey, content, version }) =>
      evaluateAndSendDm(deps, { to_pubkey, content, version }),
  );
}
