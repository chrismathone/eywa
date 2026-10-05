/** S13 runs after the real app schema has been loaded into the owned makeup_browser DB. */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { session, uid } from "./local-auth.mjs";
import { framedSurface } from "./framed-surface.mjs";

const output = process.argv[2];
if (!output) throw new Error("Synthetic S13 output directory required");
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser", username: "makeup_test", max: 1, onnotice: () => {} });
const browser = await chromium.launch({ executablePath: "C:/Users/user/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe" });
const results = [], errors = []; let active;
try {
  assert.equal((await db`select current_database() name`)[0].name, "makeup_browser");
  await mkdir(output, { recursive: true });
  for (const [actor, student] of [[29, 62], [26, 61]]) {
    const context = await browser.newContext(); context.setDefaultTimeout(60000);
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session(actor))).toString("base64url")}`, domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
    const [row] = await db`select id,mt.d(0)::text today from makeup_cases where student_id=${uid(student)} limit 1`;
    assert.ok(row);
    const frame = await framedSurface(context, `/onescreen?date=${row.today}&student=${uid(student)}&class=${uid(51)}&return=/makeups/${row.id}&embed=1`);
    active = frame;
    frame.page().on("pageerror", error => errors.push(error.message));
    await frame.setViewportSize({ width: 1440, height: 1000 });
    await expect(frame.getByText(`가상학생${student === 62 ? "B" : "A"}`, { exact: true }).first()).toBeVisible();
    for (const name of ["가상학생C", "가상학생D", "가상학생E", `가상학생${student === 62 ? "A" : "B"}`]) {
      assert.equal(await frame.getByText(name, { exact: true }).count(), 0, `foreign classmates excluded for actor ${actor}`);
    }
    await expect(frame.getByRole("button", { name: "수학 (보강) 오늘 진도", exact: true })).toBeVisible();
    const progress = frame.getByRole("button", { name: "수학 (보강) 오늘 진도", exact: true });
    await expect.poll(() => progress.evaluate(node => Object.keys(node).some(key => key.startsWith("__reactProps$") && typeof node[key]?.onClick === "function")), { timeout: 60000 }).toBe(true);
    await progress.click();
    await frame.getByRole("button", { name: "시험대비", exact: true }).click();
    await frame.keyboard.press("Escape");
    await frame.locator('textarea[placeholder*="진도·테스트·태도로"]').fill(`합성 보강 보고서: 강사 ${actor} 실제 지도`);
    const save = frame.getByRole("button", { name: "저장", exact: true });
    await expect(save).toBeEnabled();
    const saved = frame.page().waitForResponse(response => response.request().method() === "POST"
      && (response.request().postData() ?? "").includes("outOfClass")
      && (response.request().postData() ?? "").includes("합성 보강 보고서"), { timeout: 60000 });
    await save.click(); assert.equal((await saved).status(), 200);
    await expect.poll(async () => (await db`select count(*)::int n from lesson_reports where student_id=${uid(student)} and created_by=${uid(actor)} and report_date=${row.today} and makeup=true`)[0].n, { timeout: 60000 }).toBe(1);
    const [report] = await db`select makeup_class_id,created_by from lesson_reports where student_id=${uid(student)} and created_by=${uid(actor)} and report_date=${row.today}`;
    assert.equal(report.makeup_class_id, uid(51)); assert.equal(report.created_by, uid(actor));
    const [attendance] = await db`select ar.taught_by,ar.status from attendance_records ar where ar.student_id=${uid(student)} and ar.class_id=${uid(51)} and ar.session_date=${row.today}
      and not exists(select 1 from attendance_records newer where newer.supersedes_id=ar.id) order by ar.recorded_at desc,ar.id desc limit 1`;
    assert.ok(attendance); assert.equal(attendance.taught_by, uid(actor)); assert.equal(attendance.status, "makeup");
    await frame.screenshot({ path: `${output}/onescreen-conductor-${actor}.png`, fullPage: true });
    await frame.getByRole("link", { name: "보강 상세로 돌아가기", exact: true }).click();
    await frame.waitForURL(url => url.pathname === `/makeups/${row.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(new URL(frame.url()).searchParams.get("embed"), "1");
    results.push(`S13: teacher ${actor} (${actor === 29 ? "zero" : "other"} own classes) sees only assigned foreign student; real report save creates anchor cell with conductor taught_by; return preserves embed`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/onescreen-journey.json`, JSON.stringify({ boundary: "Actual Next roster/actions/PostgREST/RLS on real app migration schema; synthetic local auth/data only", results, errors }, null, 2));
  console.log(`PASS S13 (${results.length} actor journeys)`);
} catch (error) {
  if (active) {
    await active.screenshot({ path: `${output}/onescreen-failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/onescreen-failure.json`, JSON.stringify({ error: error.message, body: await active.locator("body").innerText().catch(() => ""), errors }, null, 2));
  }
  throw error;
} finally { await browser.close(); await db.end(); }
