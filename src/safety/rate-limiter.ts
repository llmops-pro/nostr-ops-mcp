// Per-minute rolling rate limiter — cheap defense against runaway LLM loops.
//
// Each bucket name (e.g. "events", "dms") tracks recent timestamps and rolls
// off entries older than 60s. take() returns whether the current operation is
// allowed; if true, it also records the timestamp.
//
// In-memory only — bucket counts reset on restart. That's fine: rate limits
// are about loop containment, not long-horizon quotas (use BudgetTracker-style
// persistence for those).

const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly limits: Map<string, number>;

  constructor(limits: Record<string, number>) {
    this.limits = new Map(Object.entries(limits));
  }

  take(bucket: string): { ok: true } | { ok: false; reason: string } {
    const limit = this.limits.get(bucket);
    if (limit === undefined) {
      // No limit configured for this bucket — pass through.
      return { ok: true };
    }
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const entries = (this.buckets.get(bucket) ?? []).filter((ts) => ts > cutoff);
    if (entries.length >= limit) {
      return {
        ok: false,
        reason: `rate limit hit on "${bucket}": ${entries.length}/${limit} in the last 60s`,
      };
    }
    entries.push(now);
    this.buckets.set(bucket, entries);
    return { ok: true };
  }

  snapshot(): Record<string, { used: number; limit: number }> {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const out: Record<string, { used: number; limit: number }> = {};
    for (const [bucket, limit] of this.limits) {
      const entries = (this.buckets.get(bucket) ?? []).filter((ts) => ts > cutoff);
      out[bucket] = { used: entries.length, limit };
    }
    return out;
  }
}
