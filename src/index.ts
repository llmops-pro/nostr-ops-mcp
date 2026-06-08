#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { hasSigner, loadConfig } from "./config.js";

// Load .env from this binary's directory (next to dist/). Lesson from nwc-mcp:
// avoid loading the cwd's .env because Claude Code may launch us from a
// sibling project's directory and pick up the wrong NOSTR_PRIVATE_KEY / NWC
// connection. Env vars passed explicitly by the parent process still win.
function tryLoadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "..", ".env");
  try {
    process.loadEnvFile(path);
  } catch {
    // file missing — fine
  }
}
tryLoadEnvFile();

import { NdkClient } from "./ndk-client.js";
import { AuditLog } from "./safety/audit-log.js";
import { ConfirmStore } from "./safety/confirm.js";
import { DmAllowlist } from "./safety/dm-allowlist.js";
import { KindAllowlist } from "./safety/kind-allowlist.js";
import { RateLimiter } from "./safety/rate-limiter.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const audit = new AuditLog(config.NOSTR_AUDIT_PATH);
  const kindAllowlist = new KindAllowlist(config.NOSTR_ALLOWED_KINDS);
  const dmAllowlist = new DmAllowlist(config.NOSTR_DM_ALLOWLIST);
  const rateLimiter = new RateLimiter({
    events: config.NOSTR_MAX_EVENTS_PER_MINUTE,
    dms: config.NOSTR_MAX_DMS_PER_MINUTE,
  });
  const confirm = new ConfirmStore();

  const ndk = new NdkClient(config);

  // Connect NDK in the background — never block the MCP handshake on relay
  // reachability. If a relay is slow or down, await-ing connect() hangs the
  // whole server, which makes Claude Code report "still connecting" forever and
  // never registers our tools. Tools that hit the network will wait for their
  // own queries; the pool gets populated as relays come online.
  ndk.connect().catch((err) => {
    process.stderr.write(
      `nostr-mcp: warning: relay pool connect error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  const server = new McpServer(
    { name: "nostr-ops-mcp", version: "0.2.1" },
    { capabilities: { tools: {} } },
  );

  registerAllTools({
    server,
    config,
    ndk,
    audit,
    kindAllowlist,
    dmAllowlist,
    rateLimiter,
    confirm,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await audit.record({
    tool: "_startup",
    outcome: "ok",
    result: {
      signer_configured: hasSigner(config),
      signer_kind: config.NOSTR_PRIVATE_KEY
        ? "nsec"
        : config.NOSTR_NIP46_URI
          ? "nip46"
          : null,
      relay_count: config.NOSTR_RELAYS.length,
      read_only: config.NOSTR_READ_ONLY,
      dm_tools_enabled: config.NOSTR_DM_TOOLS_ENABLED,
      allowed_kinds: kindAllowlist.entries,
      dm_allowlist_size: dmAllowlist.entries().length,
      require_confirm: config.NOSTR_REQUIRE_CONFIRM,
      rate_limits: rateLimiter.snapshot(),
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    await audit.record({ tool: "_shutdown", outcome: "ok", result: { signal } });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`nostr-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
