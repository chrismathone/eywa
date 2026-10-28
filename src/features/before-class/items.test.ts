import { describe, expect, it } from "vitest";
import { classDatesInMonth, defaultCheckDate, shortDateLabel } from "./dates";
import { completionRate, isBlankCheck, needsSupplement, normalizeCard, normalizeMissed, summarizeStudent } from "./items";

describe("비포클래스 판정", () => {
  it("완료율 = 체크 안 된 항목 ÷ 10 · 결석이면 null", () => {
    expect(completionRate({ missed: [], absent: false, card: null })).toBe(1);
    expect(completionRate({ missed: ["concept_note", "deadline"], absent: false, card: null })).toBe(0.8);
    expect(completionRate({ missed: ["concept_note"], absent: true, card: null })).toBeNull();
  });

  it("보충 필요 = 미흡 3개 이상(시트 조건부 서식) · 결석은 아님", () => {
    expect(needsSupplement({ missed: ["concept_note", "deadline"], absent: false, card: null })).toBe(false);
    expect(needsSupplement({ missed: ["concept_note", "deadline", "materials"], absent: false, card: null })).toBe(true);
    expect(needsSupplement({ missed: ["concept_note", "deadline", "materials"], absent: true, card: null })).toBe(false);
  });

  it("모르는 키·중복은 버리고 항목 차례로 정렬한다", () => {
    expect(normalizeMissed(["deadline", "x", "preview_video", "deadline", 3])).toEqual(["preview_video", "deadline"]);
    expect(normalizeCard("gold")).toBe("gold");
    expect(normalizeCard("purple")).toBeNull();
  });

  it("빈 칸 판정과 학생 요약", () => {
    expect(isBlankCheck({ missed: [], absent: false, card: null })).toBe(true);
    expect(isBlankCheck({ missed: [], absent: false, card: "none" })).toBe(false);
    const s = summarizeStudent([
      { missed: ["concept_note", "deadline", "materials"], absent: false, card: "red" },
      { missed: ["concept_note"], absent: false, card: null },
      { missed: [], absent: true, card: null },
    ]);
    expect(s.average).toBeCloseTo((0.7 + 0.9) / 2);
    expect(s.supplementCount).toBe(1);
    expect(s.absentCount).toBe(1);
    expect(s.itemCounts.get("concept_note")).toBe(2);
  });
});

describe("수업일", () => {
  it("그날 살아 있는 배치 행의 요일만 센다", () => {
    const rows = [
      { day_of_week: "mon", valid_from: null, valid_to: null },
      { day_of_week: "thu", valid_from: "2026-10-15", valid_to: null },
      { day_of_week: "fri", valid_from: null, valid_to: "2026-10-02" },
    ];
    expect(classDatesInMonth("2026-10", rows)).toEqual([
      "2026-10-02", "2026-10-05", "2026-10-12", "2026-10-15", "2026-10-19", "2026-10-22", "2026-10-26", "2026-10-29",
    ]);
  });

  it("기본 날짜 = 오늘 수업일 → 지난 마지막 수업일 → 첫 수업일", () => {
    const dates = ["2026-10-26", "2026-10-29"];
    expect(defaultCheckDate(dates, "2026-10-26")).toBe("2026-10-26");
    expect(defaultCheckDate(dates, "2026-10-28")).toBe("2026-10-26");
    expect(defaultCheckDate(dates, "2026-10-01")).toBe("2026-10-26");
    expect(defaultCheckDate([], "2026-10-01")).toBeNull();
    expect(shortDateLabel("2026-10-26")).toBe("10/26(월)");
  });
});
