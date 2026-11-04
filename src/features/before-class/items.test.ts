import { describe, expect, it } from "vitest";
import { classDatesInMonth, defaultCheckDate, pickCheckDate, shortDateLabel } from "./dates";
import { completionRate, DONE_CHECK, isBlankCheck, needsSupplement, normalizeCard, normalizeMissed, reportCheckLevels, reportCheckRows, summarizeStudent, autoCard, effectiveCard } from "./items";

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

describe("보고서 시안 눈금", () => {
  it("한 항목 줄 = 상/하 · 묶은 줄 = 상/중/하 · 결석 = 값 없음", () => {
    const rows = reportCheckLevels({ missed: ["concept_note", "main_solve", "main_review", "sub_review"], absent: false, card: null });
    expect(rows.map((r) => `${r.label}:${r.level}`)).toEqual(["예습영상:상", "개념정리:하", "풀이노트정리:상", "문제풀이:중", "오답정리:하"]);
    expect(reportCheckLevels({ missed: [], absent: true, card: null }).every((r) => r.level === null)).toBe(true);
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

describe("pickCheckDate — 주소의 날짜", () => {
  const dates = ["2026-10-05", "2026-10-12", "2026-10-26"];
  it("first·last는 그 달 첫·마지막 수업일", () => {
    expect(pickCheckDate(dates, "2026-10-20", "first")).toBe("2026-10-05");
    expect(pickCheckDate(dates, "2026-10-20", "last")).toBe("2026-10-26");
  });
  it("수업일이면 그날, 아니면 기본 날", () => {
    expect(pickCheckDate(dates, "2026-10-20", "2026-10-26")).toBe("2026-10-26");
    expect(pickCheckDate(dates, "2026-10-20", "2026-10-13")).toBe("2026-10-12");
    expect(pickCheckDate([], "2026-10-20", "last")).toBeNull();
  });
});

describe("reportCheckRows — 수업보고서 '수업 평가' 표에 붙는 줄(원장 2026-10-30)", () => {
  it("체크 없음 = 줄 없음 · 결석 = 줄 없음 · 모두 해 옴 = 다섯 줄 상", () => {
    expect(reportCheckRows(null)).toEqual([]);
    expect(reportCheckRows({ missed: [], absent: true, card: null })).toEqual([]);
    expect(reportCheckRows(DONE_CHECK).map((r) => `${r.label}:${r.level}`)).toEqual(["예습영상:상", "개념정리:상", "풀이노트정리:상", "문제풀이:상", "오답정리:상"]);
  });
  it("미흡 항목은 눈금으로 — 한 항목 줄 미흡 = 하 · 묶은 줄 하나 미흡 = 중", () => {
    const rows = reportCheckRows({ missed: ["preview_video", "main_solve"], absent: false, card: null });
    expect(rows.find((r) => r.label === "예습영상")?.level).toBe("하");
    expect(rows.find((r) => r.label === "문제풀이")?.level).toBe("중");
  });
});

describe("완료율 자동 카드(원장 2026-11-02)", () => {
  const ITEM_KEYS = ["preview_video","concept_note","solution_note","print_homework","main_solve","main_review","sub_solve","sub_review","materials","deadline"];
  const miss = (n: number) => ({ missed: ITEM_KEYS.slice(0, n), absent: false, card: null });
  it("25%씩 — 75% 이상 골드 · 50% 이상 블루 · 25% 이상 옐로우 · 그 아래 레드", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => autoCard(miss(n)))).toEqual([
      "gold", "gold", "gold", "blue", "blue", "blue", "yellow", "yellow", "red", "red", "red",
    ]);
  });
  it("결석이면 자동 카드 없음 · 고른 카드가 이긴다", () => {
    expect(autoCard({ missed: [], absent: true, card: null })).toBeNull();
    expect(effectiveCard({ missed: [], absent: true, card: null })).toBeNull();
    expect(effectiveCard({ ...miss(9), card: "gold" })).toBe("gold");
    expect(effectiveCard(miss(9))).toBe("red");
  });
});
