import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the admin panel.
 *
 * Uses a local Vite server with deterministic API mocks by default. Set
 * E2E_BASE_URL to exercise the same suite against the HTTPS Compose endpoint.
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const BASE_URL = externalBaseUrl || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 30_000,
      },
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
