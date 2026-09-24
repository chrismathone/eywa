import { expect, test } from "@playwright/test";

const email = process.env.E2E_MANAGER_EMAIL;
const password = process.env.E2E_MANAGER_PASSWORD;

test.describe("new academy manager", () => {
  test.skip(!email || !password, "Set E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD for tenant smoke tests");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email!);
    await page.getByLabel("비밀번호", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  });

  test("core manager routes render without browser exceptions", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of [
      "/dashboard", "/owner", "/staff", "/classes", "/timetable", "/students",
      "/enrollment", "/consultations", "/attendance", "/attendance/live",
      "/billing", "/lesson-reports", "/exams", "/meetings", "/documents", "/help", "/me",
    ]) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), route).toBe(200);
      await expect(page, route).not.toHaveURL(/\/login|\/unavailable/);
      await expect(page.locator("body"), route).not.toContainText("Application error");
    }
    expect(errors).toEqual([]);
  });

  test("manager cannot open superadmin and disabled modules", async ({ page }) => {
    await page.goto("/super-admin/tenants");
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/unavailable(?:\?|$)/);
  });
});
