// Kind-allowlist for sign/publish operations.
//
// NOSTR has thousands of event kinds. Without an allowlist, an agent with a
// signer could sign anything: an impersonation profile (kind 0), a deletion
// request (kind 5), zap requests (kind 9734), or any custom kind. The
// operator must explicitly opt in to specific kinds.
//
// An empty allowlist is treated as "deny all" — the server refuses to start
// in write mode without NOSTR_ALLOWED_KINDS being set (see config.ts).

export class KindAllowlist {
  private readonly allowed: ReadonlySet<number>;

  constructor(kinds: readonly number[]) {
    this.allowed = new Set(kinds);
  }

  get entries(): number[] {
    return Array.from(this.allowed).sort((a, b) => a - b);
  }

  isAllowed(kind: number): boolean {
    return this.allowed.has(kind);
  }

  check(kind: number): { ok: true } | { ok: false; reason: string } {
    if (this.allowed.has(kind)) return { ok: true };
    return {
      ok: false,
      reason: `event kind ${kind} is not in NOSTR_ALLOWED_KINDS (allowed: ${this.entries.join(", ") || "<none>"})`,
    };
  }
}
