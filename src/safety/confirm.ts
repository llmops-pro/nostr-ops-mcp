// Two-step confirmation token store for sign/publish tools.
//
// Same pattern as nwc-mcp's ConfirmStore: when NOSTR_REQUIRE_CONFIRM=true, a
// write tool returns a short-lived token instead of broadcasting. The agent
// calls `nostr_confirm_publish` (forthcoming) with the token to actually run
// the broadcast.

import { randomBytes } from "node:crypto";

export type PendingAction = {
  tool: string;
  params: Record<string, unknown>;
  summary: string;
};

export type StoredPendingAction = PendingAction & {
  token: string;
  expires_at: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class ConfirmStore {
  private readonly pending = new Map<string, StoredPendingAction>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  prepare(action: PendingAction): { token: string; expires_at: number } {
    this.pruneExpired();
    const token = randomBytes(16).toString("hex");
    const expires_at = Date.now() + this.ttlMs;
    this.pending.set(token, { ...action, token, expires_at });
    return { token, expires_at };
  }

  consume(token: string): StoredPendingAction | null {
    this.pruneExpired();
    const stored = this.pending.get(token);
    if (!stored) return null;
    this.pending.delete(token);
    return stored;
  }

  peek(token: string): StoredPendingAction | null {
    this.pruneExpired();
    return this.pending.get(token) ?? null;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, action] of this.pending) {
      if (action.expires_at <= now) this.pending.delete(token);
    }
  }
}
