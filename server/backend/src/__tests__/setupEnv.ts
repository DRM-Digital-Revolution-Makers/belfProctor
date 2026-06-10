// Disable DB-bound side effects when modules are imported.
process.env.NO_DB = process.env.NO_DB || "1";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test_key_for_jest_unit_tests";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_for_jest";
