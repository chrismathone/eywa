import { describe, expect, it } from "vitest";
import { buildHasStudentsOn, type ClassEnrollmentRow } from "./english-class-presence";

const row = (over: Partial<ClassEnrollmentRow> = {}): ClassEnrollmentRow => ({
  class_id: "c1",
  start_date: "2026-10-01",
  end_date: null,
  on_hold: false,
  is_transferred: false,
  attendance_days: null,
  ...over,
});
const MON = "2026-10-12";

describe("buildHasStudentsOn — 그날 그 반에 보고서를 받을 학생이 있나", () => {
  it("수강 중인 학생이 있으면 true, 수강 행이 없는 반은 false", () => {
    const has = buildHasStudentsOn([row()]);
    expect(has("c1", MON)).toBe(true);
    expect(has("c2", MON)).toBe(false);
  });

  it.each([
    ["휴원", row({ on_hold: true })],
    ["시작 전", row({ start_date: "2026-10-13" })],
    ["종료 뒤", row({ end_date: "2026-10-11" })],
    ["반이동 당일(이미 새 반)", row({ end_date: MON, is_transferred: true })],
    ["분리등원 — 그 요일에 안 옴", row({ attendance_days: ["tue"] })],
  ])("%s이면 그날 학생 없음", (_label, r) => {
    expect(buildHasStudentsOn([r])(r.class_id, MON)).toBe(false);
  });

  it("일반 종료 당일은 아직 학생이 있다", () => {
    expect(buildHasStudentsOn([row({ end_date: MON })])("c1", MON)).toBe(true);
  });

  it("한 명이라도 오면 true", () => {
    const has = buildHasStudentsOn([row({ on_hold: true }), row({ attendance_days: ["mon"] })]);
    expect(has("c1", MON)).toBe(true);
  });
});
