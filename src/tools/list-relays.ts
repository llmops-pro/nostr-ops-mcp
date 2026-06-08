import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { textResult } from "./_result.js";

export function registerListRelays(
  server: McpServer,
  ndk: NdkClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nostr_list_relays",
    {
      description:
        "List the configured relay pool with each relay's current connection status.",
    },
    async () => {
      const relays = ndk.relayStatus();
      await audit.record({
        tool: "nostr_list_relays",
        outcome: "ok",
        result: { relay_count: relays.length },
      });
      return textResult({ relays });
    },
  );
}
