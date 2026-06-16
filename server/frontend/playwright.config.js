import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the admin panel.
 *
 * Assumes the full stack is already running and serving the SPA + API at
 * BASE_URL (default http://127.0.0.1:8080). Bring it up with:
 *   docker run ... postgres   (or docker compose up postgres)
 *   cd server/backend && npm run build && PORT=8080 ... node dist/index.js
 * See TEST_PLAN.md for the exact single-laptop steps.
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
