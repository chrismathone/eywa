/** Synthetic UI journey. Auth transport is local; commands/RLS use actual migrations. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";
import { session, uid } from "./local-auth.mjs";
import { dryRunJourney } from "./dry-run-journey.mjs";
import { workspaceJourney } from "./workspace-journey.mjs";
import { framedSurface } from "./framed-surface.mjs";
import { workspaceSurface, mobileEmbed } from "./workspace-surface.mjs";

const origin = "http://127.0.0.1:3045";
const output = process.argv[2];
if (!output) throw new Error("Synthetic evidence output directory required");
const originalOffset = Number(process.argv[3] ?? -7), workspaceOffset = Number(process.argv[4] ?? -12);
assert.ok([originalOffset, workspaceOffset].every(value => Number.isInteger(value) && value < 0 && value > -730), "Owned synthetic date offsets required");
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser",
  username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {} });
const browser = await chromium.launch({ executablePath:
  "C:/Users/user/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe", timeout: 30000 });
console.log("Synthetic browser launched");
const errors = [], results = [];
let active;
const contextFor = async actor => {
  const context = await browser.newContext();
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session(actor))).toString("base64url")}`,
    domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }]);
  return context;
};
const option = async (form, name, id) => {
  const select = form.locator(`select[name="${name}"]`);
  await expect.poll(() => select.evaluate(node => Object.keys(node).some(key => key.startsWith("__reactProps$"))), { timeout: 30000 }).toBe(true);
  await select.locator("..").getByRole("button", { name: "검색", exact: true }).click();
  await form.locator(`select[name="${name}"] option[value="${id}"]`).waitFor({ state: "attached" });
  await select.selectOption(id);
};
const saved = async form => {
  await expect.poll(() => form.evaluate(node => Object.keys(node).some(key => key.startsWith("__reactProps$") && typeof node[key]?.onSubmit === "function")), { timeout: 30000 }).toBe(true);
  const originalForm = await form.elementHandle();
  assert.ok(originalForm);
  const response = form.page().waitForResponse(result => result.request().method() === "POST"
    && (result.request().postData() ?? "").includes('"command_id"'));
  await form.getByRole("button", { name: /^(분량 승인|예약 확정|참여 기록|검토 제출|실시 인정|종결|대사 실행|기존 약속 연결)$/ }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  // Keep the actual form: a locator filtered by its submit label disappears while the label is "처리 중…".
  await expect.poll(() => originalForm.evaluate(node => !node.isConnected ||
    (!node.querySelector("fieldset[disabled]") && !node.querySelector('button[type="submit"][disabled]'))), { timeout: 30000 }).toBe(true);
  await originalForm.dispose();
  console.log("Synthetic command response received");
};
try {
  assert.equal((await db`select current_database() as name`)[0].name, "makeup_browser");
  await mkdir(output, { recursive: true });
  const [date] = await db`select mt.d(0)::text as today, mt.d(${originalOffset})::text as original`;
  const admin = await contextFor(22), page = active = await workspaceSurface(admin, "/makeups/new");
  console.log("Synthetic intake frame loaded");
  page.page().on("pageerror", error => errors.push(error.message));
  await option(page.locator("form").last(), "student_id", uid(62));
  console.log("Synthetic student options loaded");
  await option(page.locator("form").last(), "original_class_id", uid(51));
  console.log("Synthetic class options loaded");
  await page.locator('input[name="original_date"]').fill(date.original);
  await page.locator('textarea[name="note"]').fill("합성 UI 테스트: 결석 근거 수동 접수");
  await page.getByRole("button", { name: "접수 · 승인 대기로 저장" }).click();
  console.log("Synthetic intake submitted");
  await page.waitForURL(url => /^\/makeups\/[0-9a-f-]{36}$/.test(url.pathname), { waitUntil: "domcontentloaded" });
  const caseId = new URL(page.url()).pathname.split("/").pop();
  let form = page.locator("form").filter({ has: page.getByRole("button", { name: "분량 승인" }) });
  await form.locator('input[name="target_minutes"]').fill("110");
  await form.locator('textarea[name="note"]').fill("가상 운영 정책: 110분 개별 승인");
  await saved(form);
  await page.getByText("예정 회차 예약", { exact: true }).click();
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "예약 확정" }) });
  await option(form, "teacher_id", uid(25));
  await option(form, "classroom_id", uid(41));
  await form.locator('input[name="period_ids"]').nth(2).check();
  await form.locator('input[name="period_ids"]').nth(3).check();
  await form.locator(`input[name="allocation:${caseId}"]`).fill("110");
  await saved(form);
  await expect.poll(async () => (await db`select committed_minutes from makeup_cases where id=${caseId}`)[0]?.committed_minutes).toBe(110);
  const [before] = await db`select target_minutes, outstanding_minutes, committed_minutes from makeup_cases where id=${caseId}`;
  assert.deepEqual(before, { target_minutes: 110, outstanding_minutes: 110, committed_minutes: 110 });
  results.push("UI intake → approval → reservation; O=110,C=110");
  // These two records are synthetic PRECONDITIONS, not a test of ordinary attendance/report UI.
  const [attendance] = await db`insert into attendance_records(tenant_id,class_id,student_id,session_date,status,session_units,recorded_by,taught_by)
    values(${uid(11)},${uid(51)},${uid(62)},${date.today},'makeup',null,${uid(25)},${uid(25)}) returning id`;
  const [report] = await db`insert into lesson_reports(tenant_id,student_id,report_date,subject,class_id,makeup_class_id,makeup,progress,notes,created_by)
    values(${uid(11)},${uid(62)},${date.today},'math',null,${uid(51)},true,'합성 지도 범위','합성 실제 110분 확인',${uid(25)}) returning id`;
  await page.reload();
  await page.getByText("참여 기록·출결 연결", { exact: true }).click();
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "참여 기록", exact: true }) });
  await option(form, "attendance_record_id", attendance.id);
  await option(form, "report_id", report.id);
  await form.locator('textarea[name="reason"]').fill("합성 실시 출결·실제 강사·보고서 확인");
  await saved(form);
  await page.getByText("실시 기록 검토 제출", { exact: true }).click();
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "검토 제출", exact: true }) });
  await option(form, "report_id", report.id);
  await form.locator('textarea[name="learning_summary"]').fill("가상학생B 문제풀이 110분, 실제 지도 확인");
  await saved(form);
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "실시 인정", exact: true }) });
  await form.locator('input[name^="recognition:"]').fill("110");
  await form.locator('textarea[name="reason"]').fill("실시자와 다른 관리자: 출결과 보강 보고서 검토");
  await saved(form);
  await expect.poll(async () => (await db`select recognized_minutes from makeup_cases where id=${caseId}`)[0]?.recognized_minutes).toBe(110);
  const [after] = await db`select outstanding_minutes, committed_minutes, recognized_minutes from makeup_cases where id=${caseId}`;
  assert.deepEqual(after, { outstanding_minutes: 0, committed_minutes: 0, recognized_minutes: 110 });
  assert.equal((await db`select session_units from attendance_records where id=${attendance.id}`)[0].session_units, null);
  assert.equal((await db`select created_by from lesson_reports where id=${report.id}`)[0].created_by, uid(25));
  results.push("UI participation → submission → independent recognition; O=0,C=0; money/ownership unchanged");
  await page.screenshot({ path: `${output}/desktop-detail.png`, fullPage: true });
  await mobileEmbed(admin, `/makeups/${caseId}?embed=1`, `${output}/mobile-detail.png`, framedSurface);
  results.push("read-only 390px detail embed has no page-level horizontal overflow");
  const teacher = await contextFor(25), phone = await teacher.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${origin}/makeups/${caseId}`);
  await expect(phone.getByText("가상학생B", { exact: true }).first()).toBeVisible();
  assert.equal(await phone.getByRole("button", { name: "실시 인정", exact: true }).count(), 0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: `${output}/mobile-teacher-detail.png`, fullPage: true });
  results.push("390px actual teacher shell shows scoped detail and hides self-review");
  const unassigned = await contextFor(26), scoped = await framedSurface(unassigned, `/makeups/${caseId}?embed=1`);
  assert.equal(await scoped.getByText("가상학생B", { exact: false }).count(), 0);
  results.push("same-tenant unassigned teacher cannot expose case student");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}/makeups/reconciliation?embed=1`);
  await expect(page.getByRole("heading", { name: "대사 실행 상태" })).toBeVisible();
  await page.getByText("현재 기록 다시 대사", { exact: true }).focus();
  await page.keyboard.press("Enter");
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "대사 실행", exact: true }) });
  await form.locator('textarea[name="reason"]').fill("합성 화면 검증: 완료 후 현재 기록 재확인");
  await saved(form);
  await expect.poll(async () => (await db`select status from makeup_reconciliation_runs where tenant_id=${uid(11)} order by started_at desc limit 1`)[0]?.status).toBe("succeeded");
  assert.deepEqual((await db`select outstanding_minutes, committed_minutes, recognized_minutes from makeup_cases where id=${caseId}`)[0], after);
  assert.equal((await db`select session_units from attendance_records where id=${attendance.id}`)[0].session_units, null);
  await mobileEmbed(admin, "/makeups/reconciliation?embed=1", `${output}/mobile-reconciliation.png`, framedSurface);
  results.push("keyboard opens reconciliation; UI scan succeeded without quantity/money changes; 390px queue fits");
  results.push(await dryRunJourney({ db, page, saved, uid, output, mobileProbe: (path, file) => mobileEmbed(admin, path, file, framedSurface) }));
  const other = await contextFor(31), foreign = await framedSurface(other, `/makeups/${caseId}?embed=1`);
  assert.equal(await foreign.getByText("가상학생B", { exact: false }).count(), 0);
  results.push("foreign tenant/off-mode cannot expose case student");
  results.push(await workspaceJourney({ contextFor, db, uid, output, errors, option, originalOffset: workspaceOffset }));
  assert.deepEqual(errors, []);
  await writeFile(`${output}/journey.json`, JSON.stringify({ boundary: "Local auth stub; actual Next server actions + makeup SQL. Attendance/report fixture preconditions; no production calls.", results, errors }, null, 2));
  console.log(`PASS ${results.length} UI journey assertions`);
} catch (error) {
  if (active) {
    await active.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/failure.json`, JSON.stringify({ url: active.url(), body: await active.locator("body").innerText().catch(() => ""), error: error.message, errors }, null, 2));
  }
  throw error;
} finally { await browser.close(); await db.end(); }
