import { test, expect } from "@playwright/test";

test("login page renders when unauthenticated", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
