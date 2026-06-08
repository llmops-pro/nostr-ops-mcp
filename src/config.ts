import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

const csvInts = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return [] as number[];
    const parts = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const nums: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${p}" is not a non-negative integer (NOSTR kinds are 0..65535)`,
        });
        return z.NEVER;
      }
      nums.push(n);
    }
    return nums;
  });

const positiveInt = z.coerce.number().int().positive();

const ConfigSchema = z
  .object({
    // Signer — provide at most one. If neither is set the server starts in
    // forced read-only mode (only the query/decode tools register).
    NOSTR_PRIVATE_KEY: z.string().optional(),
    NOSTR_NIP46_URI: z.string().optional(),

    // Relays — required for the server to do anything meaningful.
    NOSTR_RELAYS: csv,

    // Safety — required *if* a signer is configured.
    NOSTR_ALLOWED_KINDS: csvInts,

    // Safety — optional.
    NOSTR_READ_ONLY: boolish,
    NOSTR_DM_TOOLS_ENABLED: boolish,
    NOSTR_DM_ALLOWLIST: csv,
    NOSTR_REQUIRE_CONFIRM: boolish,
    NOSTR_MAX_EVENTS_PER_MINUTE: positiveInt.default(10),
    NOSTR_MAX_DMS_PER_MINUTE: positiveInt.default(5),
    NOSTR_ALLOW_NSEC_DECODE: boolish,

    // Logging.
    NOSTR_LOG_PATH: z.string().default("./nostr-mcp.log"),
    NOSTR_AUDIT_PATH: z.string().default("./nostr-mcp-audit.log"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NOSTR_PRIVATE_KEY && cfg.NOSTR_NIP46_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOSTR_PRIVATE_KEY"],
        message:
          "Set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI, not both. NIP-46 is the recommended path for shipped buyer configs.",
      });
    }
    const signerConfigured = Boolean(cfg.NOSTR_PRIVATE_KEY || cfg.NOSTR_NIP46_URI);
    if (signerConfigured && !cfg.NOSTR_READ_ONLY && cfg.NOSTR_ALLOWED_KINDS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOSTR_ALLOWED_KINDS"],
        message:
          "NOSTR_ALLOWED_KINDS is required when a signer is configured. Be explicit about which event kinds the server may sign (e.g. 1 for text notes, 4 for legacy DMs, 30017/30018 for NIP-15 marketplace).",
      });
    }
    if (cfg.NOSTR_RELAYS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOSTR_RELAYS"],
        message:
          "NOSTR_RELAYS must list at least one wss:// relay (comma-separated for multiple).",
      });
    }
    for (const url of cfg.NOSTR_RELAYS) {
      if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NOSTR_RELAYS"],
          message: `Relay "${url}" must use ws:// or wss:// scheme.`,
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    process.stderr.write(
      `nostr-mcp: invalid configuration:\n${issues}\n\nSet the required env vars and try again.\n`,
    );
    process.exit(1);
  }
  if (parsed.data.NOSTR_PRIVATE_KEY) {
    process.stderr.write(
      "nostr-mcp: NOSTR_PRIVATE_KEY is set (nsec on disk). For production / buyer setups, prefer NOSTR_NIP46_URI so the signing key stays on a phone or bunker.\n",
    );
  }
  return parsed.data;
}

export function hasSigner(config: Config): boolean {
  return Boolean(config.NOSTR_PRIVATE_KEY || config.NOSTR_NIP46_URI);
}

export function isWriteEnabled(config: Config): boolean {
  return hasSigner(config) && !config.NOSTR_READ_ONLY;
}
