import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const inputSchema = {
  name: z.string().optional().describe("Display name."),
  about: z.string().optional().describe("Short bio."),
  picture: z.string().url().optional().describe("Avatar URL."),
  banner: z.string().url().optional().describe("Banner URL."),
  nip05: z.string().optional().describe("NIP-05 identifier (e.g. alice@getalby.com)."),
  lud16: z.string().optional().describe("Lightning Address (LUD-16) for receiving zaps."),
  website: z.string().url().optional().describe("Website URL."),
  display_name: z.string().optional().describe("Preferred display name (vs `name`)."),
};

export function registerPublishMetadata(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "nostr_publish_metadata",
    {
      description:
        "Publish a kind:0 profile metadata event. **Always demands two-step confirmation** (regardless of NOSTR_REQUIRE_CONFIRM) because it overwrites your public profile and is hard to reason about safely from an LLM context. Requires kind 0 to be in NOSTR_ALLOWED_KINDS — explicitly opt in.",
      inputSchema,
    },
    async (args) => {
      // Strip undefined fields so we don't publish JSON like {"name": "x", "about": null}.
      const profile: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string" && v.length > 0) profile[k] = v;
      }
      return evaluateAndPublish(
        deps,
        { kind: 0, content: JSON.stringify(profile), tags: [] },
        {
          auditTool: "nostr_publish_metadata",
          alwaysConfirm: true,
          summary: `replace public profile with: ${Object.keys(profile).join(", ") || "<empty>"}`,
          extraAuditInput: { fields_set: Object.keys(profile) },
        },
      );
    },
  );
}
