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
    const { fatalErrors } = buildConfig(env);
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
  it("GIVEN production with no encryption key WHEN building THEN it is fatal", () => {
    const env = baseProdEnv();
    delete env.ENCRYPTION_KEY;
    const { fatalErrors } = buildConfig(env);
    expect(fatalErrors.some((e) => e.toLowerCase().includes("encryption"))).toBe(
      true,
    );
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

  it("GIVEN ALLOW_DEFAULT_ENCRYPTION_KEY in production WHEN building THEN the default is allowed with a warning", () => {
    const { config, warnings } = buildConfig({
      ...baseProdEnv(),
      ALLOW_DEFAULT_ENCRYPTION_KEY: "1",
    });
    expect(config.allowDefaultEncryptionKey).toBe(true);
    expect(warnings.some((w) => w.includes("ALLOW_DEFAULT_ENCRYPTION_KEY"))).toBe(
      true,
    );
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
  });

  it("GIVEN no DATABASE_URL in production WHEN building THEN it is fatal", () => {
    const env = baseProdEnv();
    delete env.DATABASE_URL;
    const { fatalErrors } = buildConfig(env);
    expect(fatalErrors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });
});

describe("buildConfig — admin bootstrap", () => {
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
