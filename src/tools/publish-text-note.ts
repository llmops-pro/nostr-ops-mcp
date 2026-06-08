import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const hex64 = /^[0-9a-fA-F]{64}$/;

const inputSchema = {
  content: z.string().min(1).describe("The text note's body."),
  reply_to_event_id: z
    .string()
    .regex(hex64)
    .optional()
    .describe(
      "Optional. If set, the note is a reply to this event id (adds an `e` tag with marker `reply`).",
    ),
  reply_to_author: z
    .string()
    .regex(hex64)
    .optional()
    .describe("Optional. Author pubkey of the event being replied to (adds a `p` tag)."),
  mention_pubkeys: z
    .array(z.string().regex(hex64))
    .optional()
    .describe("Optional. Additional pubkeys to mention (adds `p` tags)."),
  hashtags: z
    .array(z.string())
    .optional()
    .describe('Optional. Hashtags to attach (adds `t` tags). Don\'t include the `#` prefix.'),
};

export function registerPublishTextNote(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "nostr_publish_text_note",
    {
      description:
        "Convenience wrapper for publishing a kind:1 text note. Builds the `e` / `p` / `t` tags from the structured inputs (replies, mentions, hashtags) so the agent doesn't have to assemble them. Requires kind 1 to be in NOSTR_ALLOWED_KINDS.",
      inputSchema,
    },
    async ({ content, reply_to_event_id, reply_to_author, mention_pubkeys, hashtags }) => {
      const tags: string[][] = [];
      if (reply_to_event_id) {
        // Marker "reply" is per NIP-10. We don't have the relay hint here, leave empty.
        tags.push(["e", reply_to_event_id, "", "reply"]);
      }
      if (reply_to_author) tags.push(["p", reply_to_author]);
      for (const pk of mention_pubkeys ?? []) {
        if (pk !== reply_to_author) tags.push(["p", pk]);
      }
      for (const h of hashtags ?? []) {
        tags.push(["t", h.replace(/^#/, "")]);
      }
      return evaluateAndPublish(
        deps,
        { kind: 1, content, tags },
        { auditTool: "nostr_publish_text_note" },
      );
    },
  );
}
