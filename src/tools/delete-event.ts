import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  event_id: z
    .string()
    .regex(hex64)
    .describe("The event id (32-byte hex) to request deletion of."),
  reason: z
    .string()
    .max(280)
    .optional()
    .describe("Optional human-readable reason. Goes in the deletion event's content field."),
};

export function registerDeleteEvent(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "nostr_delete_event",
    {
      description:
        "Publish a NIP-09 kind:5 deletion request for a previously-published event. **Soft delete** — relays may or may not honor it, and copies on relays you didn't reach stay. Requires kind 5 to be in NOSTR_ALLOWED_KINDS.",
      inputSchema,
    },
    async ({ event_id, reason }) => {
      return evaluateAndPublish(
        deps,
        {
          kind: 5,
          content: reason ?? "",
          tags: [["e", event_id]],
        },
        {
          auditTool: "nostr_delete_event",
          extraAuditInput: { target_event_id: event_id },
        },
      );
    },
  );
}
