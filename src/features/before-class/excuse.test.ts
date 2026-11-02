import { describe, expect, it } from "vitest";
import { attendanceAbsentKeys, prevAbsentDates, shiftYmd } from "./excuse";
import {
  DONE_CHECK, checkFromRow, completionRate, effectiveCard, excuseReasonOf, excuseText, isBlankCheck, isExcused,
  needsSupplement, reportCheckRows, summarizeStudent,
} from "./items";
import { totalStat } from "./stats";

describe("지난 수업 결석 → 자동 제외(원장 2026-11-02)", () => {
  const active = ["2026-10-27", "2026-10-30", "2026-11-03", "2026-11-06"];
  it("앞 수업일이 결석인 날만 · 범위 안만 · 첫 수업일은 아님", () => {
    expect(prevAbsentDates(active, new Set(["2026-10-30"]), "2026-11-01", "2026-11-30")).toEqual(["2026-11-03"]);
    // 달을 넘어 앞 수업을 본다(10/30 결석 → 11/03 제외) · 범위 밖(10/30)은 안 낸다.
    expect(prevAbsentDates(active, new Set(["2026-10-27", "2026-10-30"]), "2026-11-01", "2026-11-30")).toEqual(["2026-11-03"]);
    expect(prevAbsentDates(active, new Set(["2026-11-06"]), "2026-10-01", "2026-11-30")).toEqual([]);
  });

  it("출석부 = 정정 뒤 그날 교시가 모두 결석·공결일 때만", () => {
    const r = (id: string, slot: string, status: string, at: string) => ({
      id, student_id: "s", class_id: "c", session_date: "2026-10-30", slot_start: slot, status, recorded_at: at,
    });
    expect(attendanceAbsentKeys([r("1", "16:00", "absent", "2026-10-30T10:00:00Z")])).toEqual(new Set(["c|s|2026-10-30"]));
    // 결석을 출석으로 정정
    expect(attendanceAbsentKeys([r("1", "16:00", "absent", "2026-10-30T10:00:00Z"), r("2", "16:00", "present", "2026-10-30T11:00:00Z")]).size).toBe(0);
    // 두 교시 중 한 교시 출석
    expect(attendanceAbsentKeys([r("1", "16:00", "absent", "2026-10-30T10:00:00Z"), r("2", "17:00", "late", "2026-10-30T10:00:00Z")]).size).toBe(0);
    expect(attendanceAbsentKeys([r("1", "16:00", "excused", "2026-10-30T10:00:00Z")]).size).toBe(1);
  });

  it("shiftYmd", () => {
    expect(shiftYmd("2026-11-01", -45)).toBe("2026-09-17");
  });
});

describe("체크 제외 판정", () => {
  const auto = { ...DONE_CHECK, missed: ["deadline", "materials", "concept_note"], autoExcused: true };
  it("자동 제외 = 사유 '지난 수업 결석' · 완료율·보충·미흡 없음 · 카드 X · 보고서 줄 없음", () => {
    expect(isExcused(auto)).toBe(true);
    expect(excuseReasonOf(auto)).toBe("prev_absent");
    expect(completionRate(auto)).toBeNull();
    expect(needsSupplement(auto)).toBe(false);
    expect(effectiveCard(auto)).toBe("none");
    expect(effectiveCard({ ...auto, card: "gold" })).toBe("none");
    expect(reportCheckRows(auto)).toEqual([]);
    expect(summarizeStudent([auto]).itemCounts.size).toBe(0);
  });

  it("선생님이 정한 값이 자동을 이긴다 · 결석이 제외를 이긴다", () => {
    expect(isExcused({ ...auto, excused: false })).toBe(false);
    expect(isExcused({ ...DONE_CHECK, excused: true })).toBe(true);
    expect(excuseReasonOf({ ...DONE_CHECK, excused: true })).toBeNull();
    expect(isExcused({ ...auto, absent: true })).toBe(false);
  });

  it("기타 = 적은 글", () => {
    expect(excuseText({ ...DONE_CHECK, excused: true, excuseReason: "other", excuseNote: " 병원 " })).toBe("병원");
    expect(excuseText({ ...DONE_CHECK, excused: true, excuseReason: "first_lesson" })).toBe("첫 수업(신규·반이동)");
  });

  it("자동 제외만 있는 칸은 빈 칸(저장 안 함) · 직접 정한 제외는 빈 칸 아님", () => {
    expect(isBlankCheck({ ...DONE_CHECK, autoExcused: true })).toBe(true);
    expect(isBlankCheck({ ...DONE_CHECK, excused: false })).toBe(false);
    expect(isBlankCheck({ ...DONE_CHECK, excused: true, excuseReason: "prev_absent" })).toBe(false);
  });

  it("행 변환 — 제외 칸이 없는 옛 행도", () => {
    expect(checkFromRow({ missed: ["deadline"], absent: false, card: null })).toEqual({
      missed: ["deadline"], absent: false, card: null, excused: null, excuseReason: null, excuseNote: null,
    });
    expect(checkFromRow({ missed: [], absent: false, card: null, excused: true, excuse_reason: "nope", excuse_note: "x" }).excuseReason).toBeNull();
  });

  it("통계 — 제외 날은 평균·미흡·카드에서 빠지고 횟수만", () => {
    const t = totalStat([
      { date: "2026-11-03", check: auto },
      { date: "2026-11-06", check: { ...DONE_CHECK, missed: ["deadline"] } },
    ]);
    expect(t.excusedCount).toBe(1);
    expect(t.average).toBeCloseTo(0.9);
    expect(t.itemCounts.deadline).toBe(1);
    expect(t.itemCounts.materials).toBe(0);
    expect(t.cardCounts).toEqual({ blue: 0, gold: 1, red: 0, yellow: 0, none: 0 });
  });
});
