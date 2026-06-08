# nostr-ops-mcp

**A NOSTR identity for your LLM agent.** MCP server that exposes NOSTR protocol primitives — sign, publish, query, NIP-19 encode/decode, NIP-05 lookup, encrypted DMs — as tools your agent can call. Drop it into Claude Desktop, Claude Code, Cursor, or any MCP-speaking client. Hand the agent a NIP-46 bunker key (not a raw nsec). Set a kind allowlist. Let it post on your behalf within rails you control.

> **v0.1 — full read + write + DM surface.** 16 tools wrapped in a defense-in-depth safety stack: kind allowlist (deny-by-default), recipient allowlist, rate limits, optional two-step confirmation, structured audit log. Supports both nsec (dev) and NIP-46 bunker (production).

---

## What you can do with this

- **A bot that publishes kind:1 notes from your npub** — daily summaries, scheduled posts, programmatic reactions to incoming events.
- **A NOSTR sales agent** — pair with [`marketplace-mcp`](https://npmjs.com/package/marketplace-mcp) to publish NIP-15 stalls + products as the same identity.
- **Profile management** — `nostr_publish_metadata` for kind:0 (always demands confirmation — overwriting your profile is irreversible without older relay data).
- **DM-driven workflows** — a storefront agent that watches incoming DMs (with `nostr_list_dms`), decrypts orders, and replies via `nostr_send_dm`. Default-off behind `NOSTR_DM_TOOLS_ENABLED`.
- **Cross-server identity** — share the same NIP-46 bunker URI across `nostr-ops-mcp` and `marketplace-mcp`. One key, one identity, two specialized tool surfaces.

The safety stack is the load-bearing reason this is usable in production: an agent with the keys to publish *as you* can ruin your reputation in seconds if unconstrained. The server enforces what kinds it'll sign, what rate, optional second-step confirmation, and writes every call to a structured audit log.

---

## The sixteen tools

### Read-only — local (no network, no signer needed)

| Tool | Purpose |
|---|---|
| `nostr_decode` | Parse NIP-19 strings (npub / nsec / note / nevent / naddr / nprofile). `nsec` decoding gated behind `NOSTR_ALLOW_NSEC_DECODE=true`. |
| `nostr_encode` | Build NIP-19 strings from raw fields. `nsec` encoding deliberately not supported. |

### Read-only — network (no signer needed for query/profile/nip05)

| Tool | Purpose |
|---|---|
| `nostr_get_pubkey` | Returns the signer's pubkey + npub. Errors clearly if no signer configured. |
| `nostr_list_relays` | Configured relay pool + each relay's connection status. |
| `nostr_query_events` | The workhorse. NIP-01 filters: `kinds`, `authors`, `e_tag` / `p_tag` / `d_tag` / `t_tag` tag filters (mapped to NIP-01 `#e`/`#p`/`#d`/`#t` internally — renamed in v0.2.0 for hosted-API schema compatibility), `since` / `until` / `limit`. |
| `nostr_get_profile` | Fetch + parse kind:0 metadata for a pubkey or npub. Returns the parsed JSON content (name, about, picture, nip05, lud16, …). |
| `nostr_verify_nip05` | Resolve `name@domain` → pubkey via `/.well-known/nostr.json`. Optional `expected_pubkey` for verification mode. |

### Write (require signer; gated by KindAllowlist + RateLimiter + optional confirm)

| Tool | Purpose |
|---|---|
| `nostr_publish_event` | The primitive write tool. Pass kind / content / tags. |
| `nostr_publish_text_note` | Convenience for kind:1. Reply/mention/hashtag shortcuts auto-assemble into NIP-10 tags. |
| `nostr_publish_metadata` | Kind:0 profile. **Always demands two-step confirmation** regardless of `NOSTR_REQUIRE_CONFIRM` — overwriting your profile is hard to reason about. |
| `nostr_publish_addressable_event` | Kinds 30000–39999 (replaceable). Sets the `d` tag automatically. The bridge `marketplace-mcp` uses for NIP-15. |
| `nostr_delete_event` | NIP-09 kind:5 soft delete. Best-effort — relays may ignore. |
| `nostr_confirm_publish` | Execute a token-gated publish. Single-use; safety pipeline re-runs. |

### DMs (highest-risk; default-off via `NOSTR_DM_TOOLS_ENABLED=true`)

| Tool | Purpose |
|---|---|
| `nostr_send_dm` | NIP-04 (kind:4) DM with NIP-44 encryption by default; NIP-04 supported for legacy compat. Gated by `NOSTR_DM_ALLOWLIST`. |
| `nostr_list_dms` | Fetch + decrypt the thread with a counterparty. Auto-detects NIP-44 vs NIP-04 per event. |
| `nostr_decrypt_dm` | Decrypt a single ciphertext (when you already have the event from elsewhere). |

NIP-17 sealed/gift-wrapped DMs are not yet supported — deferred to a future v0.2 (rumor events + gift-wrapping add nontrivial complexity).

---

## Requirements

- Node 20+
- A NOSTR signer — **strongly preferred:** a NIP-46 bunker URI from Amber (Android), nsec.app (web), or any other NIP-46 implementation. **Legacy path:** a raw nsec in `.env`. The server logs a stderr warning at startup when nsec-on-disk is detected.

## Install

```bash
# From npm (once published)
npx -y nostr-ops-mcp

# From source
git clone <repo>
cd nostr-ops-mcp
corepack enable pnpm
pnpm install
pnpm build
```

## Configure

```bash
cp .env.example .env
# edit .env: set NOSTR_NIP46_URI (recommended) OR NOSTR_PRIVATE_KEY
#           set NOSTR_RELAYS (comma-separated wss://)
#           set NOSTR_ALLOWED_KINDS (required when a signer is configured)
```

The server auto-loads `.env` from this binary's own directory (next to `dist/`) — deliberately NOT from cwd, to avoid env-var collision when multiple MCP servers run in the same Claude Code session.

### Required

| Var | Purpose |
|---|---|
| `NOSTR_RELAYS` | Comma-separated `wss://` relays. Server refuses to start if empty. |
| `NOSTR_ALLOWED_KINDS` | Comma-separated event-kind numbers the server may sign. Required when a signer is configured. Example: `1,30017,30018` for text-note + NIP-15 marketplace. Default omits kind:0 (profile) and kind:5 (delete) — both easy to misuse. |

### Signer — provide AT MOST one

| Var | Purpose |
|---|---|
| `NOSTR_NIP46_URI` | `bunker://<pubkey>?relay=...&secret=...` from Amber / nsec.app / Alby Account / any NIP-46 bunker. **Recommended.** |
| `NOSTR_PRIVATE_KEY` | Raw `nsec1...`. Dev/legacy only. Server warns at startup. |

### Optional safety knobs

| Var | Default | Purpose |
|---|---|---|
| `NOSTR_READ_ONLY` | `false` | Force read-only — disables all write tools. |
| `NOSTR_DM_TOOLS_ENABLED` | `false` | Opt-in for `send_dm` / `list_dms` / `decrypt_dm`. |
| `NOSTR_DM_ALLOWLIST` | unset | Hex pubkeys allowed as DM recipients. Empty = `NOSTR_DM_TOOLS_ENABLED` alone gates. |
| `NOSTR_REQUIRE_CONFIRM` | `false` | Two-step confirm: write tools return a token, `nostr_confirm_publish` executes. |
| `NOSTR_MAX_EVENTS_PER_MINUTE` | `10` | Rolling 60s rate limit on writes. |
| `NOSTR_MAX_DMS_PER_MINUTE` | `5` | Same but for DMs. |
| `NOSTR_ALLOW_NSEC_DECODE` | `false` | Allow `nostr_decode` to return raw private key material. **Don't enable unless you really need it.** |
| `NOSTR_LOG_PATH` | `./nostr-mcp.log` | Server log path. |
| `NOSTR_AUDIT_PATH` | `./nostr-mcp-audit.log` | Structured audit log (one JSON line per tool call). |

---

## Wire into an MCP client

### Claude Code (project-scoped)

```bash
claude mcp add nostr-ops -s project node "$(pwd)/dist/index.js"
```

### Claude Desktop / Cursor / other clients

```json
{
  "mcpServers": {
    "nostr-ops": {
      "command": "npx",
      "args": ["-y", "nostr-ops-mcp"],
      "env": {}
    }
  }
}
```

Because the server loads its own `.env`, leave the `env` block empty in the client config — keep secrets out of any committed file.

---

## Safety model

Every write tool runs the pipeline in this order:

1. **`NOSTR_READ_ONLY` gate** — refuse outright.
2. **Signer presence** — refuse if neither nsec nor NIP-46 URI is configured.
3. **KindAllowlist** — refuse if the event kind isn't in `NOSTR_ALLOWED_KINDS`.
4. **RateLimiter** — refuse if the rolling 60s `events` bucket is full.
5. **Confirm gate** — if `NOSTR_REQUIRE_CONFIRM=true` (or the tool always-confirms, like `publish_metadata`), return a 16-byte hex token instead of signing.
6. **Sign + publish** — via NDK; the signer handshake completes lazily on first use (relevant for NIP-46 where the bunker handshake is async).
7. **Audit log** — append-only JSON line for every attempt (ok / blocked / error).

DM tools add three more checks on top: `NOSTR_DM_TOOLS_ENABLED`, `DmAllowlist` (per-recipient), and a separate `dms` rate bucket.

**The floor is your signer.** If using NIP-46, the bunker can refuse any sign request — that's the strongest safety boundary. This server's checks are belt-and-suspenders on top.

### Verifying calls actually went through

```bash
tail -n 5 nostr-mcp-audit.log
```

Successful publish: `{"ts":"...","tool":"nostr_publish_text_note","outcome":"ok","result":{"event_id":"...","relays_accepted":[...]}}`. Blocked / error lines are equally structured. The audit log is **append-only by intent** — rotate it as part of your operational hygiene.

---

## Testing

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # 13 vitest cases (KindAllowlist, RateLimiter, nip19 roundtrip)
pnpm build       # dist/index.js (~58 KB ESM bundle)
```

For end-to-end testing against live relays, configure a throwaway nsec + a couple of public relays (damus.io, nos.lol) and run a small loop: `nostr_publish_text_note` → `nostr_query_events` to confirm the note round-tripped. The `nostr_send_dm` → `nostr_list_dms` loop validates the DM path (you can DM yourself for a closed-loop check).

---

## Companion servers

- [`nwc-mcp`](https://npmjs.com/package/nwc-mcp) — Lightning wallet over NWC. Pair these to build sats-spending NOSTR agents.
- `marketplace-mcp` — NIP-15 marketplace publish (Shopstr-compatible). Uses the same signer setup as this server.

---

## License

MIT — see [`LICENSE`](./LICENSE).

## Contact / Issues

Built by **LLMOps.Pro**.

- **NOSTR:** [`npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw`](https://njump.me/npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw) — follow, DM, zap.
- **Lightning Address:** `sovereigncitizens@getalby.com` — for support zaps and "this was useful" tips.
- **Bug reports / feature requests:** open a GitHub issue (link forthcoming).
- **Security issues:** please disclose privately via NOSTR DM before opening a public issue.
