import "dotenv/config";
import { z } from "zod";
import { resolveUploadDir } from "./runtimePaths";

/**
 * Single, validated source of truth for all runtime configuration.
 *
 * WHY this module exists:
 *  - Scattered `process.env.X || default` reads make it impossible to reason
 *    about what the server actually requires, and let insecure defaults
 *    (e.g. JWT_SECRET="devsecret") silently reach production.
 *  - Centralizing validation lets us *fail fast* in production on a
 *    misconfiguration instead of booting into an exploitable state, while
 *    staying permissive in development/test so local work is frictionless.
 *
 * `buildConfig` is intentionally pure (no process.exit, no console): it only
 * computes the config plus lists of warnings/fatal errors. The module-level
 * glue at the bottom performs the side effects (logging + exit). This keeps
 * the validation logic unit-testable.
 */

// ── Security policy constants ────────────────────────────────────────────────

/** Secrets we have shipped as examples/defaults and must never accept in prod. */
const KNOWN_WEAK_SECRETS: ReadonlySet<string> = new Set([
  "devsecret",
  "secret",
  "changeme",
  "change_me",
  "change_me_long_random",
  "password",
  "jwt_secret",
  "supersecretjwt",
]);

/** Minimum acceptable length for a production JWT secret. */
const MIN_JWT_SECRET_LENGTH = 16;

/**
 * Fixed (insecure) secret used ONLY in development/test when none is provided.
 * Fixed rather than random so admin tokens survive a dev server restart.
 */
const DEV_FALLBACK_JWT_SECRET = "dev-only-insecure-jwt-secret-do-not-use-in-prod";

/** Test secret used when running under NODE_ENV=test without an explicit one. */
const TEST_FALLBACK_JWT_SECRET = "test-only-jwt-secret";

/**
 * The all-zeros encryption key the client falls back to when no key is
 * configured. Kept here as the single source so {@link keyring} references it
 * instead of re-hardcoding the literal.
 */
export const INSECURE_DEFAULT_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

// ── Environment schema ────────────────────────────────────────────────────────

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),

  // Secrets
  JWT_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_KEYS: z.string().optional(),
  ALLOW_DEFAULT_ENCRYPTION_KEY: boolFromEnv,

  // Admin bootstrap
  DEFAULT_ADMIN_EMAIL: z.string().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().optional(),

  // Database
  DATABASE_URL: z.string().optional(),
  DB_CONNECT_RETRIES: z.coerce.number().int().min(0).max(100).default(10),
  DB_CONNECT_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(2000),

  // HTTP
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10000),
  DISABLE_FILE_LOGS: boolFromEnv,

  // Retention (days)
  RETENTION_SCREENSHOTS_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_ACTIVITY_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_HEARTBEAT_DAYS: z.coerce.number().int().positive().default(2),
  RETENTION_COMMANDS_DAYS: z.coerce.number().int().positive().default(7),
  RETENTION_APP_HISTORY_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_EVENTS_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_BROWSER_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_WORK_SESSIONS_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_PC_SESSIONS_DAYS: z.coerce.number().int().positive().default(180),
  RETENTION_TIMESHEET_DAYS: z.coerce.number().int().positive().default(400),
  RETENTION_REPORTS_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_SERVER_LOGS_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_CLIENT_LOGS_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_AGENT_VERSIONS_KEEP: z.coerce.number().int().positive().default(5),

  // Feature flags
  FEATURE_UPDATE_V2: boolFromEnv,
  FEATURE_WORK_TRACKING: boolFromEnv,
  FEATURE_PROJECT_MAPPING: boolFromEnv,
  FEATURE_LIVE_VIEW: boolFromEnv,
  FEATURE_RULES_CLASSIFIER: boolFromEnv,
  LIVE_VIEW_MAX_STREAMS: z.coerce.number().int().positive().default(10),
});

type RawEnv = z.infer<typeof EnvSchema>;

export type NodeEnv = "development" | "production" | "test";

export interface RetentionConfig {
  readonly screenshotsDays: number;
  readonly activityDays: number;
  readonly heartbeatDays: number;
  readonly commandsDays: number;
  readonly appHistoryDays: number;
  readonly eventsDays: number;
  readonly browserDays: number;
  readonly workSessionsDays: number;
  readonly pcSessionsDays: number;
  readonly timesheetDays: number;
  readonly reportsDays: number;
  readonly serverLogsDays: number;
  readonly clientLogsDays: number;
  readonly agentVersionsKeep: number;
}

export interface FeatureFlags {
  readonly updateV2: boolean;
  readonly workTracking: boolean;
  readonly projectMapping: boolean;
  readonly liveView: boolean;
  readonly rulesClassifier: boolean;
}

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;

  readonly port: number;
  readonly host: string;
  readonly uploadDir: string;

  readonly jwtSecret: string;

  /** All encryption keys to try, in priority order (primary first). */
  readonly encryptionKeys: readonly string[];
  /** Whether the all-zeros default key is permitted as a decryption fallback. */
  readonly allowDefaultEncryptionKey: boolean;

  readonly admin: { readonly email: string; readonly password: string } | null;

  readonly databaseUrl: string | undefined;
  readonly dbConnect: { readonly retries: number; readonly retryDelayMs: number };

  readonly rateLimitMax: number;
  readonly fileLogsEnabled: boolean;

  readonly retention: RetentionConfig;
  readonly features: FeatureFlags;
  readonly liveViewMaxStreams: number;
}

export interface BuildConfigResult {
  readonly config: AppConfig;
  readonly warnings: readonly string[];
  readonly fatalErrors: readonly string[];
}

function isWeakSecret(secret: string): boolean {
  return KNOWN_WEAK_SECRETS.has(secret.trim().toLowerCase());
}

function parseEncryptionKeys(raw: RawEnv): string[] {
  const out: string[] = [];
  const multi = String(raw.ENCRYPTION_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const k of multi) out.push(k);
  const primary = String(raw.ENCRYPTION_KEY || "").trim();
  if (primary) out.push(primary);
  // De-duplicate while preserving priority order.
  return Array.from(new Set(out));
}

/**
 * Validate and normalize the environment. Pure: never exits or logs.
 * Whether a given problem is "fatal" depends on NODE_ENV — the same weak
 * secret is a hard error in production but only a warning in dev/test.
 */
export function buildConfig(env: NodeJS.ProcessEnv): BuildConfigResult {
  const warnings: string[] = [];
  const fatalErrors: string[] = [];

  // Treat empty-string env vars (e.g. `RATE_LIMIT_MAX=` in a .env file) as unset
  // so that schema defaults apply, matching the original `process.env.X || def`
  // semantics and avoiding `Number("") === 0` tripping `.positive()`.
  const cleanedEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    cleanedEnv[k] = v === "" ? undefined : v;
  }

  const parsed = EnvSchema.safeParse(cleanedEnv);
  if (!parsed.success) {
    // Schema-level failures (e.g. PORT="abc") are always fatal: we cannot
    // build a coherent config. Surface every issue at once.
    for (const issue of parsed.error.issues) {
      fatalErrors.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    // Fall back to defaults so the caller still gets a usable shape for logging.
    const fallback = EnvSchema.parse({});
    return {
      config: assembleConfig(fallback),
      warnings,
      fatalErrors,
    };
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === "production";
  const isTest = raw.NODE_ENV === "test";

  // ── JWT secret ──────────────────────────────────────────────────────────
  let jwtSecret: string;
  const providedJwt = (raw.JWT_SECRET || "").trim();
  if (providedJwt) {
    if (providedJwt.length < MIN_JWT_SECRET_LENGTH || isWeakSecret(providedJwt)) {
      const msg = `JWT_SECRET is weak (must be >= ${MIN_JWT_SECRET_LENGTH} chars and not a known default).`;
      if (isProduction) fatalErrors.push(msg);
      else warnings.push(`${msg} Using it anyway in ${raw.NODE_ENV}.`);
    }
    jwtSecret = providedJwt;
  } else {
    const msg = "JWT_SECRET is not set.";
    if (isProduction) {
      fatalErrors.push(`${msg} It is required in production.`);
      // Keep a value so the returned shape is valid even though we will exit.
      jwtSecret = DEV_FALLBACK_JWT_SECRET;
    } else if (isTest) {
      jwtSecret = TEST_FALLBACK_JWT_SECRET;
    } else {
      warnings.push(`${msg} Using an insecure development fallback.`);
      jwtSecret = DEV_FALLBACK_JWT_SECRET;
    }
  }

  // ── Encryption keys ─────────────────────────────────────────────────────
  const encryptionKeys = parseEncryptionKeys(raw);
  const hasRealKey = encryptionKeys.length > 0;
  if (!hasRealKey) {
    const msg =
      "Neither ENCRYPTION_KEY nor ENCRYPTION_KEYS is set; clients can only be decrypted with the insecure default key.";
    if (isProduction) fatalErrors.push(`${msg} A real key is required in production.`);
    else warnings.push(msg);
  }
  // The all-zeros default key is allowed when explicitly opted-in, or whenever
  // no real key is configured (so a fresh/dev install still works), or in any
  // non-production environment. In production WITH a real key it is rejected.
  const allowDefaultEncryptionKey =
    raw.ALLOW_DEFAULT_ENCRYPTION_KEY || !isProduction || !hasRealKey;
  if (isProduction && hasRealKey && allowDefaultEncryptionKey) {
    warnings.push(
      "ALLOW_DEFAULT_ENCRYPTION_KEY is enabled in production — the insecure default key will be accepted.",
    );
  }

  // ── Admin bootstrap ─────────────────────────────────────────────────────
  const adminEmail = (raw.DEFAULT_ADMIN_EMAIL || "").trim();
  const adminPassword = raw.DEFAULT_ADMIN_PASSWORD || "";
  let admin: AppConfig["admin"] = null;
  if (adminEmail && adminPassword) {
    admin = { email: adminEmail, password: adminPassword };
    if (isProduction && isWeakSecret(adminPassword)) {
      warnings.push("DEFAULT_ADMIN_PASSWORD looks weak — change it after first login.");
    }
  } else if (adminEmail || adminPassword) {
    warnings.push(
      "DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD: only one is set; no admin will be created. Set both or neither.",
    );
  }

  // ── Database ────────────────────────────────────────────────────────────
  const databaseUrl = (raw.DATABASE_URL || "").trim() || undefined;
  if (!databaseUrl) {
    const msg = "DATABASE_URL is not set.";
    if (isProduction) fatalErrors.push(`${msg} It is required in production.`);
    else warnings.push(`${msg} Database operations will fail until it is configured.`);
  }

  const config = assembleConfig(raw, {
    jwtSecret,
    encryptionKeys,
    allowDefaultEncryptionKey,
    admin,
    databaseUrl,
  });

  return { config, warnings, fatalErrors };
}

interface ResolvedOverrides {
  jwtSecret: string;
  encryptionKeys: string[];
  allowDefaultEncryptionKey: boolean;
  admin: AppConfig["admin"];
  databaseUrl: string | undefined;
}

function assembleConfig(
  raw: RawEnv,
  overrides?: ResolvedOverrides,
): AppConfig {
  const nodeEnv = raw.NODE_ENV as NodeEnv;
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    isDevelopment: nodeEnv === "development",
    isTest: nodeEnv === "test",

    port: raw.PORT,
    host: raw.HOST,
    uploadDir: resolveUploadDir(),

    jwtSecret: overrides?.jwtSecret ?? DEV_FALLBACK_JWT_SECRET,

    encryptionKeys: overrides?.encryptionKeys ?? parseEncryptionKeys(raw),
    allowDefaultEncryptionKey: overrides?.allowDefaultEncryptionKey ?? true,

    admin: overrides?.admin ?? null,

    databaseUrl: overrides?.databaseUrl,
    dbConnect: {
      retries: raw.DB_CONNECT_RETRIES,
      retryDelayMs: raw.DB_CONNECT_RETRY_DELAY_MS,
    },

    rateLimitMax: raw.RATE_LIMIT_MAX,
    fileLogsEnabled: !raw.DISABLE_FILE_LOGS,

    retention: {
      screenshotsDays: raw.RETENTION_SCREENSHOTS_DAYS,
      activityDays: raw.RETENTION_ACTIVITY_DAYS,
      heartbeatDays: raw.RETENTION_HEARTBEAT_DAYS,
      commandsDays: raw.RETENTION_COMMANDS_DAYS,
      appHistoryDays: raw.RETENTION_APP_HISTORY_DAYS,
      eventsDays: raw.RETENTION_EVENTS_DAYS,
      browserDays: raw.RETENTION_BROWSER_DAYS,
      workSessionsDays: raw.RETENTION_WORK_SESSIONS_DAYS,
      pcSessionsDays: raw.RETENTION_PC_SESSIONS_DAYS,
      timesheetDays: raw.RETENTION_TIMESHEET_DAYS,
      reportsDays: raw.RETENTION_REPORTS_DAYS,
      serverLogsDays: raw.RETENTION_SERVER_LOGS_DAYS,
      clientLogsDays: raw.RETENTION_CLIENT_LOGS_DAYS,
      agentVersionsKeep: raw.RETENTION_AGENT_VERSIONS_KEEP,
    },
    features: {
      updateV2: raw.FEATURE_UPDATE_V2,
      workTracking: raw.FEATURE_WORK_TRACKING,
      projectMapping: raw.FEATURE_PROJECT_MAPPING,
      liveView: raw.FEATURE_LIVE_VIEW,
      rulesClassifier: raw.FEATURE_RULES_CLASSIFIER,
    },
    liveViewMaxStreams: raw.LIVE_VIEW_MAX_STREAMS,
  };
}

// ── Module singleton: validate once, log, and stop the boot on fatal errors ───

const result = buildConfig(process.env);

for (const w of result.warnings) {
  // eslint-disable-next-line no-console
  console.warn(`[Config] ${w}`);
}

if (result.fatalErrors.length > 0) {
  for (const e of result.fatalErrors) {
    // eslint-disable-next-line no-console
    console.error(`[Config][FATAL] ${e}`);
  }
  // Fatal errors come from two sources: a genuinely malformed value (e.g.
  // PORT="abc"), which is worth stopping on in any environment, and
  // insecure-default secrets, which buildConfig only flags in production.
  // eslint-disable-next-line no-console
  console.error(
    "[Config][FATAL] Refusing to start with an insecure/invalid configuration. Fix the variables above (see .env.example).",
  );
  process.exit(1);
}

export const config: AppConfig = result.config;
