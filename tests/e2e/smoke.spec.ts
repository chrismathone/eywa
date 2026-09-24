import { test, expect } from "@playwright/test";

test("protected dashboard sends unauthenticated visitors to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page).toHaveTitle(/AYWA/);
});

test("login submitted before hydration keeps the password out of the URL", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("이메일").fill("unused@example.invalid");
    await page.getByLabel("비밀번호", { exact: true }).fill("dummy-password-123");
    const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/login");
    await page.getByRole("button", { name: "로그인" }).click();
    const submitted = await request;
    expect(new URL(submitted.url()).searchParams.has("password")).toBe(false);
    expect(page.url()).not.toContain("dummy-password-123");
  } finally {
    await context.close();
  }
});
