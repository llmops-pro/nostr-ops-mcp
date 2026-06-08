import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type NDK from "@nostr-dev-kit/ndk";
import type { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { z } from "zod";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  kinds: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe("Filter by event kind numbers (e.g. [0, 1, 30017])."),
  authors: z
    .array(z.string().regex(hex64))
    .optional()
    .describe("Filter by author pubkeys (32-byte hex)."),
  e_tag: z
    .array(z.string().regex(hex64))
    .optional()
    .describe("Filter for events tagging these event IDs (hex). Maps to NIP-01 `#e`."),
  p_tag: z
    .array(z.string().regex(hex64))
    .optional()
    .describe("Filter for events tagging these pubkeys (hex). Maps to NIP-01 `#p`."),
  d_tag: z
    .array(z.string())
    .optional()
    .describe("Filter for addressable events with these `d` tag values. Maps to NIP-01 `#d`."),
  t_tag: z
    .array(z.string())
    .optional()
    .describe("Filter for events with these hashtag `t` values. Maps to NIP-01 `#t`."),
  since: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Unix timestamp (seconds). Only events at or after this time."),
  until: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Unix timestamp (seconds). Only events at or before this time."),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(50)
    .describe("Max events to return. Default 50, hard cap 500."),
};

const QUERY_TIMEOUT_MS = 8000;

/**
 * `fetchEvents()` resolves only when EVERY relay sends EOSE; a relay that never sends one
 * (common on `#e` tag filters) makes it hang forever. Collect via a subscription that
 * resolves on EOSE OR after a timeout, returning whatever arrived. Never hangs.
 */
function fetchEventsBounded(
  ndkInstance: NDK,
  filter: NDKFilter,
  timeoutMs: number,
): Promise<NDKEvent[]> {
  return new Promise((resolve) => {
    const byId = new Map<string, NDKEvent>();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const sub = ndkInstance.subscribe(filter, { closeOnEose: true });
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sub.stop();
      } catch {
        /* already closed */
      }
      resolve([...byId.values()]);
    };
    sub.on("event", (event: NDKEvent) => {
      if (event.id) byId.set(event.id, event);
    });
    sub.on("eose", () => finish());
    timer = setTimeout(() => finish(), timeoutMs);
  });
}

export function registerQueryEvents(
  server: McpServer,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_query_events",
    {
      description:
        "Query events from the configured relay pool using NIP-01 filters. Supports kinds, authors, since/until/limit, and tag filters (#e, #p, #d, #t). Returns an array of events as plain objects (id, kind, pubkey, created_at, content, tags, sig). The workhorse read tool.",
      inputSchema,
    },
    async (args) => {
      const filter: NDKFilter = { limit: args.limit };
      if (args.kinds) filter.kinds = args.kinds;
      if (args.authors) filter.authors = args.authors;
      if (args.e_tag) filter["#e"] = args.e_tag;
      if (args.p_tag) filter["#p"] = args.p_tag;
      if (args.d_tag) filter["#d"] = args.d_tag;
      if (args.t_tag) filter["#t"] = args.t_tag;
      if (args.since !== undefined) filter.since = args.since;
      if (args.until !== undefined) filter.until = args.until;

      const auditInput = {
        kinds: args.kinds ?? null,
        author_count: args.authors?.length ?? 0,
        e_tag_count: args.e_tag?.length ?? 0,
        p_tag_count: args.p_tag?.length ?? 0,
        d_tag_count: args.d_tag?.length ?? 0,
        t_tag_count: args.t_tag?.length ?? 0,
        since: args.since ?? null,
        until: args.until ?? null,
        limit: args.limit,
      };

      try {
        const events = await fetchEventsBounded(ndk.ndk, filter, QUERY_TIMEOUT_MS);
        const arr = events
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            pubkey: e.pubkey,
            created_at: e.created_at,
            content: e.content,
            tags: e.tags,
            sig: e.sig,
          }))
          // Newest first — matches what NOSTR clients typically expect.
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

        await audit.record({
          tool: "nostr_query_events",
          outcome: "ok",
          input: auditInput,
          result: { count: arr.length },
        });
        return textResult({ count: arr.length, events: arr });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nostr_query_events",
          outcome: "error",
          input: auditInput,
          error: msg,
        });
        return errorResult(`nostr_query_events failed: ${msg}`);
      }
    },
  );
}
