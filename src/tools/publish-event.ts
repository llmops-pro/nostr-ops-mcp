import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const inputSchema = {
  kind: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "NOSTR event kind number. Must be in NOSTR_ALLOWED_KINDS. Common kinds: 0 (profile), 1 (text note), 4 (legacy DM), 5 (delete), 30017 (NIP-15 stall), 30018 (NIP-15 product).",
    ),
  content: z.string().describe("Event content payload (typically text or JSON)."),
  tags: z
    .array(z.array(z.string()))
    .optional()
    .describe('Array of tags. Each tag is an array of strings; first element is the tag letter (e.g., ["e", "<event_id>", "<relay>"]).'),
  created_at: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Unix timestamp in seconds. Defaults to now; some relays reject timestamps too far in the past or future, so don't over-set this.",
    ),
};

export function registerPublishEvent(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "nostr_publish_event",
    {
      description:
        "Sign and broadcast a raw NOSTR event of any allowed kind. The primitive write tool — other publish_* tools are convenience wrappers around this. Runs the full safety pipeline: read-only gate, signer presence, kind allowlist, rate limit, optional two-step confirmation.",
      inputSchema,
    },
    async ({ kind, content, tags, created_at }) =>
      evaluateAndPublish(
        deps,
        { kind, content, tags, created_at },
        { auditTool: "nostr_publish_event" },
      ),
  );
}
