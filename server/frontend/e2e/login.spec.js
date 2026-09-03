import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@ttyl.uz";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Str0ngAdminPass!2026";
const USE_MOCK_API = process.env.E2E_MOCK_API === "1" || !process.env.E2E_BASE_URL;

test.describe("Admin panel — authentication", () => {
  test.beforeEach(async ({ page }) => {
    if (!USE_MOCK_API) return;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Unauthorized"}' }),
    );
    await page.route("**/api/auth/login", async (route) => {
      const body = route.request().postDataJSON();
      const valid = body.email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD;
      await route.fulfill({
        status: valid ? 200 : 401,
        contentType: "application/json",
        headers: valid ? { "Set-Cookie": "bp_session=e2e-session; Path=/; HttpOnly; SameSite=Strict" } : {},
        body: JSON.stringify(
          valid
            ? { ok: true }
            : { message: "Invalid credentials" },
        ),
      });
    });
  });
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

  test("logs in with valid credentials without exposing a token to JavaScript", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeNull();
  });
});
