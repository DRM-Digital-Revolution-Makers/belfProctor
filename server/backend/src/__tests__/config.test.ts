import { buildConfig, INSECURE_DEFAULT_ENCRYPTION_KEY } from "../config";

/**
 * buildConfig is the pure core of configuration validation. These tests pin the
 * security-critical decisions: production must refuse insecure defaults, while
 * development stays permissive.
 */

const STRONG_JWT = "a-sufficiently-long-and-unique-secret-value";

function baseProdEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    JWT_SECRET: STRONG_JWT,
    ENCRYPTION_KEY: "real-client-key",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    PUBLIC_BASE_URL: "https://proctor.example.test",
  } as NodeJS.ProcessEnv;
}

describe("buildConfig — JWT secret policy", () => {
  it("GIVEN production with the shipped devsecret WHEN building THEN it is fatal", () => {
    const { fatalErrors } = buildConfig({
      ...baseProdEnv(),
      JWT_SECRET: "devsecret",
    });
    expect(fatalErrors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
  });

  it("GIVEN production with no JWT secret WHEN building THEN it is fatal", () => {
    const env = baseProdEnv();
    delete env.JWT_SECRET;
    const { config, fatalErrors } = buildConfig(env);
    expect(fatalErrors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
  });

  it("GIVEN development with no JWT secret WHEN building THEN it warns and uses a fallback (not fatal)", () => {
    const { config, fatalErrors, warnings } = buildConfig({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(fatalErrors).toHaveLength(0);
    expect(warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(16);
  });

  it("GIVEN production with a strong secret WHEN building THEN there is no JWT fatal", () => {
    const { fatalErrors } = buildConfig(baseProdEnv());
    expect(fatalErrors.some((e) => e.includes("JWT_SECRET"))).toBe(false);
  });
});

describe("buildConfig — encryption keys", () => {
  it("GIVEN production with no global encryption key WHEN building THEN per-device-only mode is valid", () => {
    const env = baseProdEnv();
    delete env.ENCRYPTION_KEY;
    const { config, fatalErrors } = buildConfig(env);
    expect(fatalErrors.some((e) => e.toLowerCase().includes("encryption"))).toBe(false);
    expect(config.encryptionKeys).toEqual([]);
    expect(config.allowDefaultEncryptionKey).toBe(false);
  });

  it("GIVEN production with a real key WHEN building THEN the insecure default is rejected", () => {
    const { config } = buildConfig(baseProdEnv());
    expect(config.allowDefaultEncryptionKey).toBe(false);
    expect(config.encryptionKeys).not.toContain(INSECURE_DEFAULT_ENCRYPTION_KEY);
  });

  it("GIVEN ENCRYPTION_KEYS and ENCRYPTION_KEY WHEN building THEN keys are ordered and de-duplicated", () => {
    const { config } = buildConfig({
      ...baseProdEnv(),
      ENCRYPTION_KEYS: "alpha, beta , alpha",
      ENCRYPTION_KEY: "gamma",
    });
    expect(config.encryptionKeys).toEqual(["alpha", "beta", "gamma"]);
  });

  it("GIVEN ALLOW_DEFAULT_ENCRYPTION_KEY in production WHEN building THEN it stays disabled", () => {
    const { config, warnings } = buildConfig({
      ...baseProdEnv(),
      ALLOW_DEFAULT_ENCRYPTION_KEY: "1",
    });
    expect(config.allowDefaultEncryptionKey).toBe(false);
  });

  it("GIVEN development WHEN building THEN the insecure default key is permitted", () => {
    const { config } = buildConfig({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(config.allowDefaultEncryptionKey).toBe(true);
  });
});

describe("buildConfig — schema robustness", () => {
  it("GIVEN a malformed PORT WHEN building THEN it is fatal", () => {
    const { fatalErrors } = buildConfig({
      ...baseProdEnv(),
      PORT: "not-a-number",
    });
    expect(fatalErrors.some((e) => e.includes("PORT"))).toBe(true);
  });

  it("GIVEN an empty-string numeric var WHEN building THEN the default applies (no fatal)", () => {
    const { config, fatalErrors } = buildConfig({
      ...baseProdEnv(),
      RATE_LIMIT_MAX: "",
    });
    expect(fatalErrors).toHaveLength(0);
    expect(config.rateLimitMax).toBe(10000);
    expect(config.loginRateLimitMax).toBe(10);
  });

  it("GIVEN an explicit login limit WHEN building THEN it is applied", () => {
    const { config, fatalErrors } = buildConfig({
      ...baseProdEnv(),
      LOGIN_RATE_LIMIT_MAX: "7",
    });
    expect(fatalErrors).toHaveLength(0);
    expect(config.loginRateLimitMax).toBe(7);
  });

  it("GIVEN malformed or excessive upload limits WHEN building THEN startup validation is fatal", () => {
    expect(buildConfig({ ...baseProdEnv(), MAX_COMMAND_RESULT_BYTES: "not-a-number" }).fatalErrors
      .some((e) => e.includes("MAX_COMMAND_RESULT_BYTES"))).toBe(true);
    expect(buildConfig({ ...baseProdEnv(), MAX_SCREENSHOT_BYTES: String(101 * 1024 * 1024) }).fatalErrors
      .some((e) => e.includes("MAX_SCREENSHOT_BYTES"))).toBe(true);
  });

  it("GIVEN valid upload limits WHEN building THEN all routes receive normalized numeric limits", () => {
    const { config, fatalErrors } = buildConfig({
      ...baseProdEnv(),
      MAX_SCREENSHOT_BYTES: "1024",
      MAX_REPORT_BYTES: "2048",
      MAX_COMMAND_RESULT_BYTES: "4096",
      MAX_UPDATE_BYTES: "8192",
    });
    expect(fatalErrors).toHaveLength(0);
    expect(config.uploadLimits).toEqual({
      screenshotBytes: 1024,
      reportBytes: 2048,
      commandResultBytes: 4096,
      updateBytes: 8192,
    });
  });

  it("GIVEN no DATABASE_URL in production WHEN building THEN it is fatal", () => {
    const env = baseProdEnv();
    delete env.DATABASE_URL;
    const { fatalErrors } = buildConfig(env);
    expect(fatalErrors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });

  it("GIVEN production without a canonical HTTPS URL WHEN building THEN it is fatal", () => {
    const env = baseProdEnv();
    delete env.PUBLIC_BASE_URL;
    expect(buildConfig(env).fatalErrors.some((e) => e.includes("PUBLIC_BASE_URL"))).toBe(true);
    expect(buildConfig({ ...env, PUBLIC_BASE_URL: "http://proctor.local" }).fatalErrors
      .some((e) => e.includes("PUBLIC_BASE_URL"))).toBe(true);
  });
});

describe("buildConfig — admin bootstrap", () => {
  it("GIVEN a weak production admin password WHEN building THEN it is fatal", () => {
    const { fatalErrors } = buildConfig({
      ...baseProdEnv(),
      DEFAULT_ADMIN_EMAIL: "admin@local",
      DEFAULT_ADMIN_PASSWORD: "password",
    });
    expect(fatalErrors.some((e) => e.includes("DEFAULT_ADMIN_PASSWORD"))).toBe(true);
  });

  it("GIVEN only an admin email WHEN building THEN no admin is configured and it warns", () => {
    const { config, warnings } = buildConfig({
      ...baseProdEnv(),
      DEFAULT_ADMIN_EMAIL: "admin@local",
    });
    expect(config.admin).toBeNull();
    expect(warnings.some((w) => w.includes("ADMIN"))).toBe(true);
  });

  it("GIVEN both admin credentials WHEN building THEN admin is configured", () => {
    const { config } = buildConfig({
      ...baseProdEnv(),
      DEFAULT_ADMIN_EMAIL: "admin@local",
      DEFAULT_ADMIN_PASSWORD: "a-strong-admin-password",
    });
    expect(config.admin).toEqual({
      email: "admin@local",
      password: "a-strong-admin-password",
    });
  });
});
