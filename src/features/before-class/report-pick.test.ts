import { describe, expect, it } from "vitest";
import { DONE_CHECK } from "./items";
import { pickReportCheck, type DayCheckRow } from "./report-pick";

const row = (class_id: string, student_id: string, extra: Partial<DayCheckRow> = {}): DayCheckRow =>
  ({ class_id, student_id, missed: [], absent: false, card: null, ...extra });

describe("pickReportCheck — MS 보고서에 JJ 체크를 붙인다(원장 2026-10-30)", () => {
  const both = new Set(["MS", "JJ"]);
  it("JJ에 그 학생 행이 있으면 그 행", () => {
    expect(pickReportCheck([row("JJ", "s1", { missed: ["main_solve"] })], both, "s1")).toEqual({ missed: ["main_solve"], absent: false, card: null, excused: null, excuseReason: null, excuseNote: null });
  });
  it("JJ 결석 행 → 결석 체크(보고서 줄 없음)", () => {
    expect(pickReportCheck([row("JJ", "s1", { absent: true })], both, "s1")?.absent).toBe(true);
  });
  it("JJ를 체크한 날 행이 없으면 모두 해 옴 · 아무도 체크 안 했으면 null", () => {
    expect(pickReportCheck([row("JJ", "s2")], both, "s1")).toEqual(DONE_CHECK);
    expect(pickReportCheck([], both, "s1")).toBeNull();
  });
  it("그 학생이 명단에 없는 반의 체크는 안 본다", () => {
    expect(pickReportCheck([row("JJ", "s2"), row("JJ", "s1")], new Set(["MS"]), "s1")).toBeNull();
  });
  it("행이 둘이면 결석이 아닌 행 먼저", () => {
    expect(pickReportCheck([row("MS", "s1", { absent: true }), row("JJ", "s1")], both, "s1")?.absent).toBe(false);
  });
});
