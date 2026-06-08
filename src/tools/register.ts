import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { DmAllowlist } from "../safety/dm-allowlist.js";
import type { KindAllowlist } from "../safety/kind-allowlist.js";
import type { RateLimiter } from "../safety/rate-limiter.js";

import { registerConfirmPublish } from "./confirm-publish.js";
import { registerDecode } from "./decode.js";
import { registerDecryptDm } from "./decrypt-dm.js";
import { registerDeleteEvent } from "./delete-event.js";
import { registerEncode } from "./encode.js";
import { registerGetProfile } from "./get-profile.js";
import { registerGetPubkey } from "./get-pubkey.js";
import { registerListDms } from "./list-dms.js";
import { registerListRelays } from "./list-relays.js";
import { registerPublishAddressableEvent } from "./publish-addressable-event.js";
import { registerPublishEvent } from "./publish-event.js";
import { registerPublishMetadata } from "./publish-metadata.js";
import { registerPublishTextNote } from "./publish-text-note.js";
import { registerQueryEvents } from "./query-events.js";
import { registerSendDm } from "./send-dm.js";
import { registerVerifyNip05 } from "./verify-nip05.js";

export type ToolDeps = {
  server: McpServer;
  config: Config;
  ndk: NdkClient;
  audit: AuditLog;
  kindAllowlist: KindAllowlist;
  dmAllowlist: DmAllowlist;
  rateLimiter: RateLimiter;
  confirm: ConfirmStore;
};

export function registerAllTools(deps: ToolDeps): void {
  const { server, config, ndk, audit, kindAllowlist, rateLimiter, confirm } = deps;

  // Read-only tools — always safe, register regardless of signer config.
  registerGetPubkey(server, ndk, audit);
  registerListRelays(server, ndk, audit);
  registerDecode(server, config, audit);
  registerEncode(server, audit);
  registerQueryEvents(server, ndk, audit);
  registerGetProfile(server, ndk, audit);
  registerVerifyNip05(server, audit);

  // Write tools — gated by evaluateAndPublish (read-only → signer → kind-allowlist →
  // rate-limit → optional confirm). All share the same shape so the agent can reason
  // about safety uniformly across them.
  const publishDeps = { config, ndk, audit, kindAllowlist, rateLimiter, confirm };
  registerPublishEvent(server, publishDeps);
  registerPublishTextNote(server, publishDeps);
  registerPublishMetadata(server, publishDeps);
  registerPublishAddressableEvent(server, publishDeps);
  registerDeleteEvent(server, publishDeps);
  registerConfirmPublish(server, { ...publishDeps, dmAllowlist: deps.dmAllowlist });

  // DM tools — additionally gated by NOSTR_DM_TOOLS_ENABLED + NOSTR_DM_ALLOWLIST.
  // Read paths (list_dms, decrypt_dm) still require the gate because they surface
  // plaintext. NIP-44 encryption preferred; NIP-04 supported for compat.
  const dmDeps = { config, ndk, audit, dmAllowlist: deps.dmAllowlist, rateLimiter, confirm };
  registerSendDm(server, dmDeps);
  registerListDms(server, config, ndk, audit);
  registerDecryptDm(server, config, ndk, audit);
}
