// DM-recipient allowlist.
//
// When NOSTR_DM_ALLOWLIST is non-empty, DMs may only be sent to those
// recipients. Match strings can be hex pubkeys (64 chars) OR npubs (the
// caller normalizes to hex before checking — see lib/nip19.ts). Empty list
// = no constraint (caller-side gate: NOSTR_DM_TOOLS_ENABLED still controls
// whether DM tools register at all).

export class DmAllowlist {
  private readonly normalized: ReadonlySet<string>;

  constructor(entries: readonly string[]) {
    this.normalized = new Set(
      entries.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
    );
  }

  get enabled(): boolean {
    return this.normalized.size > 0;
  }

  isAllowed(recipient_hex: string): boolean {
    if (!this.enabled) return true;
    return this.normalized.has(recipient_hex.trim().toLowerCase());
  }

  entries(): string[] {
    return Array.from(this.normalized);
  }
}
