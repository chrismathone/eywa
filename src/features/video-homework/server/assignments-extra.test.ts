/**
 * 원스크린 '지난 수업 영상 숙제' 검사 — 보고서 없이 **따로 낸 숙제**(원장 2026-10-13)도 '있음'이다.
 * 🔴 지난 수업 보고서가 '영상 과제 없음'이어도 그날 숙제를 따로 냈으면 다음 수업 검사 칸이 숨지 않아야 한다(적대적 리뷰 2026-10-13).
 *    오늘 값(보고서 토글)은 덮지 않는다 — 덮으면 보고서에 '있음'이 저장된다.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";

const m = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { _resetVideoHomeworkProbeForTest, getVideoHomeworkAssignments } from "./assignments";
import { _resetExtraIssuesProbeForTest } from "./extra-issues";
import { assignmentKey, hidesNextCheck } from "../assignment";

const PREV = "2026-10-06", TODAY = "2026-10-09";
beforeEach(() => {
  _resetVideoHomeworkProbeForTest(); _resetExtraIssuesProbeForTest();
  m.db = createFakeDb({
    lesson_reports: [
      { id: "prev", tenant_id: "t", student_id: "s", class_id: "c", report_date: PREV, video_homework: false },
      { id: "today", tenant_id: "t", student_id: "s", class_id: "c", report_date: TODAY, video_homework: false },
    ],
    video_homework_extra_issues: [
      { tenant_id: "t", class_id: "c", student_id: "s", homework_date: PREV, teacher_id: "teacher" },
      { tenant_id: "t", class_id: "c", student_id: "s", homework_date: TODAY, teacher_id: "teacher" },
    ],
  });
});

it("지난 수업일에 따로 낸 숙제가 있으면 '있음' — 검사 칸이 숨지 않는다 · 오늘 값은 보고서 그대로", async () => {
  const map = await getVideoHomeworkAssignments("t", ["s"], [TODAY, PREV], { issuedDates: [PREV] });
  expect(hidesNextCheck(map, "s", PREV, "c")).toBe(false);
  expect(map?.[assignmentKey("s", PREV, "c")]).toBe(true);
  expect(map?.[assignmentKey("s", TODAY, "c")]).toBe(false);
});
it("넘기지 않으면 종전대로(보고서 값만)", async () => {
  const map = await getVideoHomeworkAssignments("t", ["s"], [TODAY, PREV]);
  expect(hidesNextCheck(map, "s", PREV, "c")).toBe(true);
});
it("따로 낸 숙제를 못 읽으면 그 날짜의 '없음'만 '모름'으로 — 숨기지 않고, 지도 전체를 버리지도 않는다", async () => {
  m.db.dropColumn("video_homework_extra_issues", "homework_date");
  const map = await getVideoHomeworkAssignments("t", ["s"], [TODAY, PREV], { issuedDates: [PREV] });
  expect(map).not.toBeNull();
  expect(hidesNextCheck(map, "s", PREV, "c")).toBe(false);
  expect(map?.[assignmentKey("s", TODAY, "c")]).toBe(false);
});
it("표가 아직 없으면(SQL 적용 전) 종전대로", async () => {
  m.db.dropTable("video_homework_extra_issues");
  const map = await getVideoHomeworkAssignments("t", ["s"], [TODAY, PREV], { issuedDates: [PREV] });
  expect(hidesNextCheck(map, "s", PREV, "c")).toBe(true);
});
