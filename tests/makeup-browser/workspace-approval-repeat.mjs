/**
 * Repeats the real-workspace intake → detail → approval flow and fails if any approval does not reach the screen.
 * Synthetic records only (one new case per round, unique original dates). The stall this guards against was
 * intermittent (about 1 in 3 rounds before the fix), so a single pass proves nothing — run many rounds.
 *   node tests/makeup-browser/workspace-approval-repeat.mjs <outputDir> [rounds=20] [studentNo=61] [firstOffset=-150] [cpuSlowdown=1]
 * Unused original dates are picked from firstOffset down to d(-199) (fixture enrolment starts at d(-200)) before the
 * first round; too few free dates is an error. Any round that is not a clean pass fails the run.
 * No reload, no extra input and no timers stand in for the page update: after approving it only waits for the
 * reservation section (the server props of an approved case) for 15 seconds.
 */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { session, uid } from "./local-auth.mjs";

const [output, roundsArg = "20", studentArg = "61", offsetArg = "-150", cpuArg = "1"] = process.argv.slice(2);
if (!output) throw new Error("Synthetic evidence output directory required");
const rounds = Number(roundsArg), student = Number(studentArg), firstOffset = Number(offsetArg), cpu = Number(cpuArg);
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser", username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {} });
const browser = await chromium.launch({ executablePath: "C:/Users/user/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe", timeout: 30000 });
await mkdir(output, { recursive: true });
const results = [];

// Hydration preconditions (as journey.mjs): a click before React attaches its handlers is a lost click, not a stall.
const hydrated = (locator, prop) => expect.poll(() => locator.evaluate((node, key) => Object.keys(node).some(name =>
  name.startsWith("__reactProps$") && (key === null || typeof node[name]?.[key] === "function")), prop), { timeout: 30000 }).toBe(true);

async function freeOffsets() {
  const offsets = [];
  for (let offset = firstOffset; offset > -200 && offsets.length < rounds; offset -= 1) {
    const [row] = await db.unsafe(`select mt.d(${offset})::text as original`);
    const [used] = await db`select count(*)::int as n from makeup_cases where student_id = ${uid(student)} and original_date = ${row.original}`;
    if (!used.n) offsets.push(offset);
  }
  if (offsets.length < rounds) throw new Error(`only ${offsets.length} unused original dates between ${firstOffset} and -199 for student ${student}`);
  return offsets;
}

async function round(index, offset) {
  const context = await browser.newContext();
  context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session(22))).toString("base64url")}`, domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
  const page = await context.newPage();
  if (cpu > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let frame, caseId = null;
  try {
    const [date] = await db.unsafe(`select mt.d(${offset})::text as original`);
    await page.goto("http://127.0.0.1:3045/makeups/new", { waitUntil: "domcontentloaded" });
    const coach = page.getByRole("dialog", { name: "워크스페이스 안내" });
    await expect(coach).toBeVisible({ timeout: 30000 });
    await coach.getByRole("button", { name: "시작하기", exact: true }).click();
    await expect.poll(() => page.frames().some(item => /\/makeups\/new\?embed=1/.test(item.url())), { timeout: 45000 }).toBe(true);
    frame = page.frames().find(item => /\/makeups\/new\?embed=1/.test(item.url()));
    const choose = async (name, id) => {
      const select = frame.locator(`select[name="${name}"]`);
      await hydrated(select, null);
      await select.locator("..").getByRole("button", { name: "검색", exact: true }).click();
      await select.locator(`option[value="${id}"]`).waitFor({ state: "attached" });
      await select.selectOption(id);
    };
    await choose("student_id", uid(student)); await choose("original_class_id", uid(51));
    await frame.locator('input[name="original_date"]').fill(date.original);
    await frame.locator('textarea[name="note"]').fill(`합성 반복 승인 검사 ${index}`);
    await hydrated(frame.locator("form").filter({ has: frame.locator('input[name="original_date"]') }), "onSubmit");
    await frame.getByRole("button", { name: "접수 · 승인 대기로 저장", exact: true }).click();
    await frame.waitForURL(url => /^\/makeups\/[0-9a-f-]{36}$/.test(url.pathname) && url.searchParams.get("embed") === "1", { waitUntil: "domcontentloaded" });
    caseId = new URL(frame.url()).pathname.split("/").pop();
    const form = frame.locator("form").filter({ has: frame.getByRole("button", { name: "분량 승인", exact: true }) });
    await form.locator('input[name="target_minutes"]').fill("110");
    await form.locator('textarea[name="note"]').fill("합성 승인 110분");
    await hydrated(form, "onSubmit");
    await form.getByRole("button", { name: "분량 승인", exact: true }).click();
    await expect(frame.getByText("예정 회차 예약", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(frame.getByRole("button", { name: "처리 중…" })).toHaveCount(0);
    const [row] = await db`select eligibility, target_minutes from makeup_cases where id = ${caseId}`;
    const verdict = row?.eligibility !== "approved" || row.target_minutes !== 110 ? "db-mismatch" : errors.length ? "page-error" : "pass";
    return { index, offset, caseId, verdict, errors };
  } catch (error) {
    const [row] = caseId ? await db`select eligibility, target_minutes from makeup_cases where id = ${caseId}` : [];
    const body = frame ? await frame.locator("body").innerText().catch(() => "") : "";
    const alerts = frame ? await frame.locator('[role="alert"]').allInnerTexts().catch(() => []) : [];
    await page.screenshot({ path: `${output}/round-${index}.png`, fullPage: true }).catch(() => {});
    return { index, offset, caseId, verdict: caseId ? "stall" : "setup-error", db: row ?? null,
      processing: body.includes("처리 중…"), saved: body.includes("저장했습니다"), alerts, error: error.message.split("\n")[0], errors };
  } finally {
    await context.close();
  }
}

try {
  const offsets = await freeOffsets();
  for (let index = 0; index < rounds; index += 1) {
    const result = await round(index, offsets[index]);
    results.push(result);
    console.log(`round ${index}: ${result.verdict}${result.caseId ? ` ${result.caseId}` : ""}${result.reason ? ` (${result.reason})` : ""}`);
  }
} finally {
  // Every requested round must run to an approval check and pass: a setup error, a page error or a missing round
  // is a failure too (a round that never saved proves nothing about the refresh).
  const summary = { rounds, student, firstOffset, cpu, completed: results.length,
    passed: results.filter(item => item.verdict === "pass").length,
    failed: results.filter(item => item.verdict !== "pass").map(item => `${item.index}:${item.verdict}`),
    pageErrors: results.flatMap(item => item.errors ?? []), results };
  await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`completed ${summary.completed}/${rounds}, passed ${summary.passed}, failed [${summary.failed.join(", ")}], page errors ${summary.pageErrors.length}`);
  await browser.close(); await db.end({ timeout: 5 });
  if (summary.completed !== rounds || summary.passed !== rounds || summary.pageErrors.length) process.exitCode = 1;
}
