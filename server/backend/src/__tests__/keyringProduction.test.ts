describe("production device credential isolation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("never offers a global key for an unknown or different device", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "production-jwt-secret-with-enough-entropy";
    process.env.DATABASE_URL = "postgresql://u:p@db:5432/proctor";
    process.env.PUBLIC_BASE_URL = "https://proctor.example.test";
    process.env.ENCRYPTION_KEY = "legacy-global-key-that-must-not-be-used";
    process.env.ALLOW_DEFAULT_ENCRYPTION_KEY = "1";
    jest.resetModules();
    const { getKeysToTry } = require("../keyring") as typeof import("../keyring");
    expect(getKeysToTry()).toEqual([]);
    expect(getKeysToTry("device-specific-credential")).toEqual([
      "device-specific-credential",
    ]);
  });
});
