// Shared safety pipeline for every "sign + publish an event" tool.
//
// Pipeline order (mirrors nwc-mcp's evaluateAndExecute pattern):
//   1. NOSTR_READ_ONLY gate — refuse outright.
//   2. Signer presence — refuse if no NOSTR_PRIVATE_KEY / NOSTR_NIP46_URI.
//   3. KindAllowlist — refuse if `kind` isn't explicitly allowed.
//   4. RateLimiter — refuse if the `events` bucket is full.
//   5. ConfirmStore gate — if NOSTR_REQUIRE_CONFIRM (or the caller forces it
//      via alwaysConfirm), prepare a token and return it; tool does not sign.
//   6. Ensure signer ready (blocks on NIP-46 bunker handshake on first use).
//   7. Build NDKEvent → sign → publish → return event_id + accepted relays.
//   8. Audit log: every attempt (ok / blocked / error).

import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { Config } from "../config.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { KindAllowlist } from "../safety/kind-allowlist.js";
import type { RateLimiter } from "../safety/rate-limiter.js";
import { errorResult, textResult } from "./_result.js";

export type PublishDeps = {
  config: Config;
  ndk: NdkClient;
  audit: AuditLog;
  kindAllowlist: KindAllowlist;
  rateLimiter: RateLimiter;
  confirm: ConfirmStore;
};

export type PublishParams = {
  kind: number;
  content: string;
  tags?: string[][];
  created_at?: number;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export async function evaluateAndPublish(
  deps: PublishDeps,
  params: PublishParams,
  opts: {
    auditTool?: string;
    skipConfirmGate?: boolean;
    alwaysConfirm?: boolean;
    summary?: string;
    extraAuditInput?: Record<string, unknown>;
  } = {},
): Promise<ToolResult> {
  const auditTool = opts.auditTool ?? "nostr_publish_event";
  const inputForAudit = {
    kind: params.kind,
    content_length: params.content.length,
    tag_count: params.tags?.length ?? 0,
    ...(opts.extraAuditInput ?? {}),
  };

  if (deps.config.NOSTR_READ_ONLY) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NOSTR_READ_ONLY=true — write tools are disabled",
    });
    return errorResult("NOSTR_READ_ONLY=true — write tools are disabled");
  }

  if (!deps.ndk.hasSigner()) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "no signer configured (set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI)",
    });
    return errorResult(
      "No signer configured. Set NOSTR_PRIVATE_KEY (dev) or NOSTR_NIP46_URI (recommended) to enable signed operations.",
    );
  }

  const kindCheck = deps.kindAllowlist.check(params.kind);
  if (!kindCheck.ok) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: kindCheck.reason,
    });
    return errorResult(kindCheck.reason);
  }

  const rateCheck = deps.rateLimiter.take("events");
  if (!rateCheck.ok) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: rateCheck.reason,
    });
    return errorResult(rateCheck.reason);
  }

  const needsConfirm =
    (deps.config.NOSTR_REQUIRE_CONFIRM || opts.alwaysConfirm) && !opts.skipConfirmGate;
  if (needsConfirm) {
    const summary = opts.summary ?? `publish kind ${params.kind} event (${params.content.length} chars, ${params.tags?.length ?? 0} tags)`;
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
      next_step: `Call nostr_confirm_publish with token "${token}" to sign and broadcast.`,
    });
  }

  try {
    await deps.ndk.ensureSignerReady();
    const event = new NDKEvent(deps.ndk.ndk, {
      kind: params.kind,
      content: params.content,
      tags: params.tags ?? [],
      created_at: params.created_at ?? Math.floor(Date.now() / 1000),
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
        relays_accepted: acceptedUrls,
        relays_accepted_count: acceptedUrls.length,
      },
    });
    return textResult({
      event_id: event.id,
      kind: params.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
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
