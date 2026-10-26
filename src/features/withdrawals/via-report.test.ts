import { describe, expect, it } from "vitest";
import {
  endScopeFor,
  endsLastCourse,
  endsSubjectCourse,
  formWithdrawalViaReport,
  LAST_COURSE_VIA_REPORT,
  lastCourseGateApplies,
  SCHEDULE_VIA_REPORT,
  SUBJECT_END_VIA_REPORT,
  viaReportMessage,
  WITHDRAWAL_VIA_REPORT,
  type EndRow,
} from "./via-report";

/** 원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"* — 학생 폼·수강 종료가 같은 판정으로 거절한다. */
describe("formWithdrawalViaReport — 학생 폼(등록·수정)", () => {
  it("재원·휴원 학생을 퇴원으로 바꾸는 저장은 거절(예약을 오늘로 당기는 것 포함)", () => {
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", kind: "withdraw", withdrawnAt: "2026-10-20" })).toBe(WITHDRAWAL_VIA_REPORT);
    expect(formWithdrawalViaReport({ prevStatus: "on_hold", prevWithdrawnAt: "2026-11-01", kind: "withdraw", withdrawnAt: "2026-10-23" })).toBe(WITHDRAWAL_VIA_REPORT);
  });
  it("새 예약 · 예약 날짜 변경은 거절, 걸린 예약을 그대로 다시 저장하는 것은 통과", () => {
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", kind: "schedule", withdrawnAt: "2026-11-01" })).toBe(SCHEDULE_VIA_REPORT);
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", prevWithdrawnAt: "2026-11-01", kind: "schedule", withdrawnAt: "2026-11-02" })).toBe(SCHEDULE_VIA_REPORT);
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", prevWithdrawnAt: "2026-11-01T00:00:00", kind: "schedule", withdrawnAt: "2026-11-01" })).toBeNull();
  });
  it("새 원생 등록 — 지난 퇴원(옛 기록)은 통과, 퇴원 예약은 거절", () => {
    expect(formWithdrawalViaReport({ prevStatus: null, kind: "withdraw", withdrawnAt: "2024-03-01" })).toBeNull();
    expect(formWithdrawalViaReport({ prevStatus: null, kind: "schedule", withdrawnAt: "2026-12-01" })).toBe(SCHEDULE_VIA_REPORT);
  });
  it("이미 퇴원한 학생 고치기 · 예약 취소 · 퇴원과 무관한 저장은 통과", () => {
    expect(formWithdrawalViaReport({ prevStatus: "withdrawn", kind: "withdraw", withdrawnAt: "2026-09-01" })).toBeNull();
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", prevWithdrawnAt: "2026-11-01", kind: "none", withdrawnAt: null })).toBeNull();
    expect(formWithdrawalViaReport({ prevStatus: "enrolled", kind: "none", withdrawnAt: null })).toBeNull();
  });
});

const row = (id: string, classId: string, subject: string, start: string, end: string | null = null, extra: Partial<EndRow> = {}): EndRow => ({
  id, classId, className: classId, subject, start, end, ...extra,
});

describe("endsLastCourse — 마지막 반 종료 = 사실상 퇴원(시간표 확인 문구와 같은 판정)", () => {
  const D = "2026-10-23";
  it("하나뿐인 반을 끝내면 퇴원", () => {
    expect(endsLastCourse([row("a", "A", "math", "2026-03-01")], ["a"], D, null)).toBe(true);
  });
  it("다른 과목 반이 계속되면 과목 수강종료일 뿐 — 그대로", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("b", "B", "english", "2026-03-01")];
    expect(endsLastCourse(rows, ["a"], D, null)).toBe(false);
  });
  it("같은 과목 다른 반이 이어받으면(반 이동) · 계속 다니면(특강만 끝남) 그대로", () => {
    expect(endsLastCourse([row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-10-24")], ["a"], D, null)).toBe(false);
    expect(endsLastCourse([row("s", "S", "math", "2026-07-01"), row("r", "R", "math", "2026-03-01")], ["s"], D, null)).toBe(false);
  });
  it("모든 반을 함께 끝내면 퇴원(부분 종료로 우회 금지)", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("b", "B", "english", "2026-03-01")];
    expect(endsLastCourse(rows, ["a", "b"], D, null)).toBe(true);
  });
  it("남은 반이 곧 끝나도(14일 안) 이어지는 반이 아니다 — 퇴원", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("b", "B", "english", "2026-03-01", "2026-10-28")];
    expect(endsLastCourse(rows, ["a"], D, null)).toBe(true);
  });
  it("이미 끝난 반만 남은 학생은 남는 반이 없다 — 퇴원", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("old", "O", "english", "2025-01-01", "2025-12-31")];
    expect(endsLastCourse(rows, ["a"], D, null)).toBe(true);
  });
  it("고른 수강이 학생의 것이 아니면 판정하지 않는다(종료 함수가 '찾을 수 없음'을 말한다)", () => {
    expect(endsLastCourse([row("a", "A", "math", "2026-03-01")], ["x"], D, null)).toBe(false);
  });
});

describe("lastCourseGateApplies — 게이트를 거는 학생", () => {
  it("재원·휴원이고 퇴원 예약이 없는 학생만", () => {
    expect(lastCourseGateApplies("enrolled", null)).toBe(true);
    expect(lastCourseGateApplies("on_hold", null)).toBe(true);
  });
  it("이미 퇴원·예비·상담 · 예전에 걸린 퇴원 예약(보고서를 시작할 수 없어 막으면 막다른 길)은 막지 않는다", () => {
    expect(lastCourseGateApplies("withdrawn", "2026-09-01")).toBe(false);
    expect(lastCourseGateApplies("prospect", null)).toBe(false);
    expect(lastCourseGateApplies("enrolled", "2026-11-01")).toBe(false);
  });
});

/**
 * 원장 2026-10-26 *"그 과목의 마지막 반을 끝내는건 기존에 있던 것과 일치하게"* — 시간표 확인 문구가 '과목'이라 말하고(`endScopeOf`)
 * 퇴원관리가 '수강종료'로 세는(`getEndedSubjects` — 끝난 특강 제외) 종료만 막는다. 각 줄 = 두 판정이 갈리는 경우.
 */
describe("endsSubjectCourse — 그 과목의 마지막 반 = 과목 수강종료(퇴원관리 '수강종료'와 같은 판정)", () => {
  const D = "2026-10-26";
  const eng = row("e", "E", "english", "2026-03-01");
  it("다른 과목이 계속되는데 그 과목 하나뿐인 반을 끝내면 과목 수강종료 — 막는다", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), eng];
    expect(endsSubjectCourse(rows, ["a"], D, null)).toBe(true);
    expect(viaReportMessage(rows, ["a"], D, null)).toBe(SUBJECT_END_VIA_REPORT);
  });
  it("같은 과목 다른 반이 계속되면(특강만 끝남) · 이어받으면(반 이동) 그대로", () => {
    expect(endsSubjectCourse([row("s", "S", "math", "2026-07-01", null, { isSpecial: true }), row("r", "R", "math", "2026-03-01"), eng], ["s"], D, null)).toBe(false);
    expect(endsSubjectCourse([row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-10-27"), eng], ["a"], D, null)).toBe(false);
  });
  it("특강만 다니던 과목의 특강이 끝남 — 시간표는 '과목'이지만 퇴원관리는 수강종료로 안 센다 → 막지 않는다", () => {
    const rows = [row("s", "S", "math", "2026-07-01", null, { isSpecial: true }), eng];
    expect(endScopeFor(rows, rows[0]!, new Set(["s"]), D, null).scope).toBe("subject");
    expect(endsSubjectCourse(rows, ["s"], D, null)).toBe(false);
  });
  it("예전 정규반이 끝나 있고 남은 특강을 끝내면 — 퇴원관리가 그 과목을 수강종료로 세운다 → 막는다", () => {
    const rows = [row("o", "O", "math", "2025-03-01", "2025-12-31"), row("s", "S", "math", "2026-07-01", null, { isSpecial: true }), eng];
    expect(endsSubjectCourse(rows, ["s"], D, null)).toBe(true);
  });
  it("같은 과목 다른 반이 15일 넘어 시작(종료일 없음) — 시간표는 '과목'이지만 퇴원관리는 그 반을 다니는 중으로 본다 → 막지 않는다", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-11-20"), eng];
    expect(endScopeFor(rows, rows[0]!, new Set(["a"]), D, null).scope).toBe("subject");
    expect(endsSubjectCourse(rows, ["a"], D, null)).toBe(false);
  });
  it("같은 과목 다른 반이 며칠 뒤 끝남(14일 안) — 그날 과목 수강종료 → 막는다 · 14일 넘게 계속되면 그대로", () => {
    expect(endsSubjectCourse([row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-03-01", "2026-10-31"), eng], ["a"], D, null)).toBe(true);
    expect(endsSubjectCourse([row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-03-01", "2026-12-31"), eng], ["a"], D, null)).toBe(false);
  });
  it("학생의 마지막 반이면 퇴원 문구가 먼저(과목 문구가 아니다)", () => {
    expect(viaReportMessage([row("a", "A", "math", "2026-03-01")], ["a"], D, null)).toBe(LAST_COURSE_VIA_REPORT);
    expect(endsSubjectCourse([row("a", "A", "math", "2026-03-01")], ["a"], D, null)).toBe(false);
  });
  it("한 과목의 반을 모두 함께 끝내면 과목 수강종료(나눠 끝내기 우회 금지) · 일부만이면 그대로", () => {
    const rows = [row("a", "A", "math", "2026-03-01"), row("b", "B", "math", "2026-03-01"), eng];
    expect(endsSubjectCourse(rows, ["a", "b"], D, null)).toBe(true);
    expect(endsSubjectCourse(rows, ["a"], D, null)).toBe(false);
  });
  it("미래 시작 수강은 시작일로 닫힌다(저장과 같게) — 그래도 과목 수강종료", () => {
    const rows = [row("f", "F", "math", "2026-11-02"), eng];
    expect(endsSubjectCourse(rows, ["f"], D, null)).toBe(true);
  });
});
