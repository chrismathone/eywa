// 원생 개별 공지·교재요청서의 수업 시작 전·휴원 제외(원장 2026-11-05 *"수업 시작전이거나 휴원 중인 학생은 클래스노트 배정을 하지말것.
// 수업배정이 되는 순간 동기화 작동하게"*) — 순수 판정.
import { describe, expect, it } from "vitest";
import { noticeStandingOf, standingSubjectsOf, type StandingClass, type StandingEnrollment } from "./notice-standing";

const D = "2026-11-05";
const classes: Record<string, StandingClass> = {
  M1: { subject: "math", is_active: true, closed_at: null },
  M2: { subject: "subject_1", is_active: true, closed_at: null }, // 수학(심화) — 수학 알림장과 같은 묶음
  E1: { subject: "english", is_active: true, closed_at: null },
  E2: { subject: "english", is_active: true, closed_at: null },
  OFF: { subject: "english", is_active: false, closed_at: null },
  CLOSED: { subject: "english", is_active: true, closed_at: "2026-10-31" },
};
const row = (class_id: string, over: Partial<StandingEnrollment> = {}): StandingEnrollment => ({
  class_id, start_date: "2026-03-01", end_date: null, is_transferred: false, on_hold: false, ...over,
});
const judge = (subject: string, rows: StandingEnrollment[], studentOnHold = false) =>
  noticeStandingOf({ subject, rows, classOf: (id) => classes[id], studentOnHold, date: D });

describe("noticeStandingOf", () => {
  it("그 과목에 오늘 다니는 반이 있으면 제외하지 않는다", () => {
    expect(judge("english", [row("E1")])).toBeNull();
    // 다른 반은 시작 전이어도 지금 다니는 반이 있으면 보낸다
    expect(judge("english", [row("E1"), row("E2", { start_date: "2026-11-20" })])).toBeNull();
  });
  it("🔴 끝나지 않은 수강이 아직 시작 전뿐이면 '수업 시작 전'(영어 신입의 교재요청서 — 전에는 1인 보드로 갔다)", () => {
    expect(judge("english", [row("E1", { start_date: "2026-11-10" })])).toBe("not_started");
  });
  it("🔴 그 수강이 휴원·대기이거나 학생이 휴원이면 '휴원'", () => {
    expect(judge("english", [row("E1", { on_hold: true })])).toBe("on_hold");
    expect(judge("english", [row("E1")], true)).toBe("on_hold");
    // 휴원 반과 시작 전 반이 함께면 휴원(지금 쉬는 중)
    expect(judge("english", [row("E1", { on_hold: true }), row("E2", { start_date: "2026-11-20" })])).toBe("on_hold");
  });
  it("그 과목 수강이 아예 없거나 끝났으면 여기서 판정하지 않는다(종전 경로 — 수학 '반 보드 없음' · 영어 1인 보드)", () => {
    expect(judge("english", [])).toBeNull();
    expect(judge("english", [row("E1", { end_date: "2026-11-04" })])).toBeNull();
    // 반이동 당일 옛 반은 이미 끝났다(종료 규약 단일 소스)
    expect(judge("english", [row("E1", { end_date: D, is_transferred: true })])).toBeNull();
    // 다른 과목의 시작 전·휴원은 이 과목과 무관
    expect(judge("english", [row("M1", { start_date: "2026-11-10" })])).toBeNull();
    // 학생 휴원이어도 그 과목 수강이 없으면 판정하지 않는다
    expect(judge("english", [row("M1")], true)).toBeNull();
  });
  it("폐지·종강한 반의 수강은 세지 않는다", () => {
    expect(judge("english", [row("OFF", { start_date: "2026-11-10" })])).toBeNull();
    expect(judge("english", [row("CLOSED", { on_hold: true })])).toBeNull();
  });
  it("수학 알림장은 수학·수학(심화) 반을 함께 본다", () => {
    expect([...standingSubjectsOf("math")].sort()).toEqual(["math", "subject_1"]);
    expect(judge("math", [row("M2", { start_date: "2026-11-10" })])).toBe("not_started");
    expect(judge("math", [row("M1"), row("M2", { on_hold: true })])).toBeNull();
  });
});
