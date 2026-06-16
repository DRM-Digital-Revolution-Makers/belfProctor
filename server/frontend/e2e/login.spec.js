import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@ttyl.uz";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Str0ngAdminPass!2026";

test.describe("Admin panel — authentication", () => {
  test("the login page renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("BelfProctor").first()).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("rejects wrong credentials and keeps you logged out", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill("definitely-wrong");
    await page.locator('button[type="submit"]').click();
    // Stay logged out — no token is stored.
    await page.waitForTimeout(1500);
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeFalsy();
  });

  test("logs in with valid credentials and stores a token", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    // Success is signalled by a JWT landing in localStorage.
    await page.waitForFunction(() => !!localStorage.getItem("token"), null, {
      timeout: 10_000,
    });
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });
});
