import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const inputSchema = {
  kind: z
    .number()
    .int()
    .min(30000)
    .max(39999)
    .describe(
      "Addressable event kind in the parameterized-replaceable range (30000–39999). NIP-15 marketplace uses 30017 (stall) and 30018 (product).",
    ),
  d_tag: z
    .string()
    .min(1)
    .describe(
      "The `d` tag identifier — uniquely names this replaceable event within the kind+pubkey combination. Republishing with the same (kind, pubkey, d) replaces the prior version.",
    ),
  content: z.string().describe("Event content (typically JSON for NIP-15)."),
  tags: z
    .array(z.array(z.string()))
    .optional()
    .describe("Additional tags. The `d` tag is set automatically from d_tag — do not duplicate it here."),
};

export function registerPublishAddressableEvent(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "nostr_publish_addressable_event",
    {
      description:
        "Publish a parameterized-replaceable / addressable event (kind 30000–39999). The marketplace MCP's load-bearing bridge — NIP-15 stalls (kind 30017) and products (kind 30018) flow through this. Sets the `d` tag automatically from the `d_tag` input. Republishing with the same (kind, pubkey, d_tag) replaces the prior version on relays that honor replaceability.",
      inputSchema,
    },
    async ({ kind, d_tag, content, tags }) => {
      const dTagPair: string[] = ["d", d_tag];
      const extraTags = (tags ?? []).filter((t) => t[0] !== "d");
      const fullTags: string[][] = [dTagPair, ...extraTags];
      return evaluateAndPublish(
        deps,
        { kind, content, tags: fullTags },
        {
          auditTool: "nostr_publish_addressable_event",
          extraAuditInput: { d_tag },
        },
      );
    },
  );
}
