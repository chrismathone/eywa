/** Audit regressions on synthetic records only, through the real app/actions/RPCs. */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { usabilityListJourney } from "./usability-list-journey.mjs";

export async function usabilityJourney({ db, uid, context, caseId, output, option, framedSurface }) {
  const results = [];
  const frame = await framedSurface(context, `/makeups/${caseId}?embed=1`);
  const formFor = label => frame.locator("form").filter({ has: frame.getByRole("button", { name: label, exact: true }) });
  const save = async (form, label) => {
    await expect.poll(() => form.evaluate(node => Object.keys(node).some(key => key.startsWith("__reactProps$") && typeof node[key]?.onSubmit === "function")), { timeout: 45000 }).toBe(true);
    const response = frame.page().waitForResponse(value => value.request().method() === "POST" && (value.request().postData() ?? "").includes('"command_id"'), { timeout: 45000 });
    const node = await form.elementHandle();
    await form.getByRole("button", { name: label, exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect.poll(() => node.evaluate(value => !value.isConnected || !value.querySelector("fieldset[disabled]")), { timeout: 45000 }).toBe(true);
    await node.dispose();
  };
  // S01/R05: undo and re-record explicitly. Reversed evidence is visible but no longer prefilled.
  await frame.getByText("인정 정정", { exact: true }).click();
  let form = formFor("인정 반전");
  await form.locator('textarea[name="reason"]').fill("합성 재검토: 인정량 다시 확인");
  await save(form, "인정 반전");
  await frame.getByText("참여 기록·출결 연결", { exact: true }).click();
  form = formFor("참여 기록");
  await expect(form.locator('textarea[name="learning_summary"]')).toHaveValue("");
  await expect(form.locator('input[name="actual_minutes"]')).toHaveValue("");
  await form.locator('input[name="actual_minutes"]').fill("110");
  await form.locator('textarea[name="learning_summary"]').fill("합성 재확인한 지도 110분 근거");
  await form.locator('textarea[name="reason"]').fill("정정 이후 실제 지도 다시 확인");
  await save(form, "참여 기록");
  await frame.getByText("실시 기록 검토 제출", { exact: true }).click();
  form = formFor("검토 제출");
  await expect(form.locator('textarea[name="learning_summary"]')).toHaveValue("합성 재확인한 지도 110분 근거");
  await form.locator('textarea[name="learning_summary"]').fill("");
  await save(form, "검토 제출");
  form = formFor("실시 인정");
  await expect(form.locator('input[name^="recognition:"]')).toHaveAttribute("max", "110");
  await form.locator('input[name^="recognition:"]').fill("110");
  await form.locator('textarea[name="reason"]').fill("합성 재인정 근거 확인");
  await save(form, "실시 인정");
  assert.equal((await db`select recognized_minutes from makeup_cases where id=${caseId}`)[0].recognized_minutes, 110);
  results.push("S01/A08/R05: UI reverse → fresh evidence → submit reuses stored evidence → reverify max=110");

  // S02: fully vacated old session does not block changing only the room at the same time.
  const [seed] = await db`select mt.approved_case(mt.id(61),mt.id(51),mt.d(-30),60) as id`;
  const [reservation] = await db`select mt.reserved(mt.id(22),mt.id(61),${seed.id}::uuid,mt.d(0),array['1'],50) as id`;
  const [old] = await db`select session_id from makeup_participants where id=${reservation.id}`;
  await frame.goto(`http://127.0.0.1:3045/makeups/${seed.id}?embed=1`, { waitUntil: "domcontentloaded" });
  await frame.getByText("이 학생의 일정 변경", { exact: true }).click();
  form = formFor("일정 변경");
  await option(form, "teacher_id", uid(25));
  await option(form, "classroom_id", uid(42));
  await form.locator('input[name="period_ids"]').first().check();
  await form.locator('textarea[name="reason"]').fill("합성 동일 시간 강의실만 변경");
  await save(form, "일정 변경");
  const [moved] = await db`select s.state, n.classroom_id from makeup_sessions s join makeup_sessions n on n.id=s.replaced_by_session_id where s.id=${old.session_id}`;
  assert.deepEqual(moved, { state: "rescheduled", classroom_id: uid(42) });
  results.push("S02: same-time room change succeeds only after vacating old session");
  await frame.screenshot({ path: `${output}/usability-reschedule.png`, fullPage: true });

  // S03: valid original enrollment ended before the makeup; resolve the missing attendance class from the queue.
  const [anchorCase] = await db`select mt.approved_case(mt.id(64),mt.id(52),mt.d(-5),120) as id`;
  await db`update enrollments set end_date=mt.d(-1) where student_id=mt.id(64) and class_id=mt.id(52)`;
  await db`insert into enrollments(tenant_id,student_id,class_id,start_date) values(mt.id(11),mt.id(64),mt.id(51),mt.d(-1))`;
  const [unanchored] = await db`select mt.reserved(mt.id(22),mt.id(64),${anchorCase.id}::uuid,mt.d(2),array['1','2'],50) as id`;
  await frame.goto("http://127.0.0.1:3045/makeups/reconciliation?embed=1", { waitUntil: "domcontentloaded" });
  form = frame.locator("form").filter({ has: frame.locator('select[name="anchor_class_id"]') });
  await option(form, "anchor_class_id", uid(51));
  await form.locator('textarea[name="reason"]').fill("합성 학생의 실시 날짜 수강 반 확인");
  const beforeAttendance = (await db`select count(*)::int as n from attendance_records`)[0].n;
  await save(form, "대사 확인·처리");
  assert.equal((await db`select anchor_class_id from makeup_participants where id=${unanchored.id}`)[0].anchor_class_id, uid(51));
  assert.equal((await db`select count(*)::int as n from attendance_records`)[0].n, beforeAttendance);
  results.push("S03: global queue submits selected anchor and observes state without creating attendance");
  results.push(...await usabilityListJourney({ db, uid, context, frame, caseId, output, framedSurface }));
  await frame.page().close();
  return results;
}
