import { test, expect } from "@playwright/test";

test.describe("VIEWER navigation and API failures", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/me") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: 2, email: "viewer@test", role: "VIEWER" }),
        });
      }
      if (url.pathname === "/api/events/stats") {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });
  });

  test("renders every primary read-only screen without a JavaScript failure", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const pathname of ["/", "/clients", "/screenshots", "/report", "/settings"]) {
      await page.goto(pathname);
      await expect(page.getByText("BelfProctor").first()).toBeVisible();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${pathname === "/" ? "/$" : pathname}`));
    }
    expect(errors).toEqual([]);
  });

  test("keeps the clients screen usable when its API returns 500", async ({ page }) => {
    await page.route("**/api/clients?**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"temporary failure"}' }),
    );
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /Сотрудники/i })).toBeVisible();
    await expect(page.getByText(/Сотрудники ещё не добавлены|По фильтрам ничего не найдено/i)).toBeVisible();
  });
});
