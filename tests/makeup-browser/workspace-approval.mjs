/** Diagnose the real workspace's post-command refresh using synthetic records only. */
import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import postgres from "postgres";
import { session, uid } from "./local-auth.mjs";
const output = process.argv[2];
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser", username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {} });
const browser = await chromium.launch({ executablePath: "C:/Users/user/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe", timeout: 30000 });
const context = await browser.newContext();
context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session(22))).toString("base64url")}`, domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
const page = await context.newPage();
let frame;
try {
  await page.goto("http://127.0.0.1:3045/makeups/new", { waitUntil: "domcontentloaded" });
  const coach = page.getByRole("dialog", { name: "워크스페이스 안내" });
  await expect(coach).toBeVisible();
  await coach.getByRole("button", { name: "시작하기", exact: true }).click();
  await expect.poll(() => page.frames().some(item => /\/makeups\/new\?embed=1/.test(item.url())), { timeout: 45000 }).toBe(true);
  frame = page.frames().find(item => /\/makeups\/new\?embed=1/.test(item.url()));
  const choose = async (name, id) => {
    const select = frame.locator(`select[name="${name}"]`);
    await select.locator("..").getByRole("button", { name: "검색", exact: true }).click();
    await select.locator(`option[value="${id}"]`).waitFor({ state: "attached" });
    await select.selectOption(id);
  };
  await choose("student_id", uid(62)); await choose("original_class_id", uid(51));
  const [date] = await db`select mt.d(-14)::text as original`;
  await frame.locator('input[name="original_date"]').fill(date.original);
  await frame.locator('textarea[name="note"]').fill("합성 실제 워크스페이스 승인 갱신 검사");
  await frame.getByRole("button", { name: "보강 접수", exact: true }).click();
  await frame.waitForURL(url => /^\/makeups\/[0-9a-f-]{36}$/.test(url.pathname), { waitUntil: "domcontentloaded" });
  const form = frame.locator("form").filter({ has: frame.getByRole("button", { name: "보강 시간 승인", exact: true }) });
  await form.locator('input[name="target_minutes"]').fill("110");
  await form.locator('textarea[name="note"]').fill("합성 승인 110분");
  await form.getByRole("button", { name: "보강 시간 승인", exact: true }).click();
  await expect(frame.getByText("예정 회차 예약", { exact: true })).toBeVisible();
  console.log("PASS actual workspace approval refresh");
} catch (error) {
  await writeFile(`${output}.json`, JSON.stringify({ error: error.message, url: frame?.url(), body: frame ? await frame.locator("body").innerText() : await page.locator("body").innerText() }, null, 2));
  await page.screenshot({ path: `${output}.png`, fullPage: true });
  throw error;
} finally { await browser.close(); await db.end({ timeout: 5 }); }
