// Disable DB-bound side effects when modules are imported.
process.env.NO_DB = process.env.NO_DB || "1";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test_key_for_jest_unit_tests";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_for_jest";
// Provide a dummy connection string so config validation stays quiet in tests;
// no test actually opens a connection to it.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
