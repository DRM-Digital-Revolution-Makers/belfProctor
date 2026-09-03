/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.test.json",
        diagnostics: false,
      },
    ],
  },
  setupFiles: ["<rootDir>/src/__tests__/setupEnv.ts"],
  coverageReporters: ["text", "json-summary"],
  // Release gate from FULL_AUDIT_REPORT_2026-08-31.md: every critical HTTP
  // route and report/session service must retain at least 70% line coverage.
  coverageThreshold: {
    "./src/routes/activity.ts": { lines: 70 },
    "./src/routes/auth.ts": { lines: 70 },
    "./src/routes/browserActivity.ts": { lines: 70 },
    "./src/routes/clientDeletion.ts": { lines: 70 },
    "./src/routes/commands.ts": { lines: 70 },
    "./src/routes/events.ts": { lines: 70 },
    "./src/routes/files.ts": { lines: 70 },
    "./src/routes/heartbeat.ts": { lines: 70 },
    "./src/routes/pcSession.ts": { lines: 70 },
    "./src/routes/updates.ts": { lines: 70 },
    "./src/services/pcSessionHelpers.ts": { lines: 70 },
    "./src/services/reportStore.ts": { lines: 70 },
    "./src/wsHub.ts": { lines: 70 },
  },
};
