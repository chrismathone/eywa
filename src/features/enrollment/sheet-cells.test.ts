import { describe, expect, it } from "vitest";
import { BOARD_STAGES, stageOfCard } from "./board-stages";
import { SHEET_LEGEND, sheetDate, statusCellOf, subjectCellOf } from "./sheet-cells";

/** 학원설정 과목 맵 흉내 — 라벨·색·선택지가 전부 여기서만 온다(하드코딩 없음). */
const MAPS = {
  labelOf: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k,
  colorOf: (k: string) => (({ math: "blue", english: "green" })[k] ?? "neutral") as "blue" | "green" | "neutral",
  options: [
    { value: "math", label: "수학" },
    { value: "english", label: "영어" },
  ],
};

describe("과목 칸 — 학원설정 라벨·색(원장 2026-09-02 '수업 -> 과목')", () => {
  it("설정 키는 그 과목의 라벨·색", () => {
    expect(subjectCellOf("math", MAPS)).toEqual({ label: "수학", color: "blue" });
    expect(subjectCellOf(" english ", MAPS)).toEqual({ label: "영어", color: "green" });
  });
  it("옛 시트 텍스트가 설정 과목의 라벨과 같으면 같은 과목으로(색도 같다) — 옛 행이 회색으로 갈리지 않게", () => {
    expect(subjectCellOf("수학", MAPS)).toEqual({ label: "수학", color: "blue" });
  });
  it("모르는 텍스트('영어 수학'·'매쓰몽')는 원문 그대로 + 색 없음 — 한 과목으로 우기지 않는다", () => {
    expect(subjectCellOf("영어 수학", MAPS)).toEqual({ label: "영어 수학", color: null });
    expect(subjectCellOf("매쓰몽", MAPS)).toEqual({ label: "매쓰몽", color: null });
  });
  it("빈 값은 null(칸을 비운다)", () => {
    expect(subjectCellOf(null, MAPS)).toBeNull();
    expect(subjectCellOf("  ", MAPS)).toBeNull();
  });
});

describe("목록 날짜 표기 — YY.MM.DD", () => {
  it("YYYY-MM-DD를 YY.MM.DD로 적는다(0을 남긴다)", () => {
    expect(sheetDate("2026-08-05")).toBe("26.08.05");
    expect(sheetDate("2025-12-31")).toBe("25.12.31");
  });
  it("날짜 형식이 아니면 지어내지 않는다", () => {
    expect(sheetDate(null)).toBeNull();
    expect(sheetDate("")).toBeNull();
    expect(sheetDate("7/7 5:00")).toBeNull();
  });
});

describe("상태 칸·범례 — 칸반과 같은 4단계(원장 2026-09-02)", () => {
  it("범례는 board-stages의 4칸을 순서·색 그대로 담는다(라벨·색 맵을 새로 만들지 않는다)", () => {
    expect(SHEET_LEGEND).toEqual(BOARD_STAGES.map((s) => ({ label: s.label, color: s.color })));
    expect(SHEET_LEGEND).toHaveLength(4);
  });
  it("상태 칸은 outcome 원값이 아니라 그 값이 속한 칸이다 — 예약·대기는 '상담 전', 노쇼·거절은 '미등록'", () => {
    const labelOf = (outcome: string) => statusCellOf({ outcome, assignedClassCount: 0 }).label;
    expect(labelOf("scheduled")).toBe("상담 전");
    expect(labelOf("pending")).toBe("상담 전");
    expect(labelOf("ai_done")).toBe("상담 완료");
    expect(labelOf("no_show")).toBe("미등록");
    expect(labelOf("declined")).toBe("미등록");
    expect(labelOf("enrolled")).toBe("등록 완료");
  });
  it("판정은 칸반의 stageOfCard와 같다 — 배정(수강 ≥ 1)이 outcome을 이긴다", () => {
    const card = { outcome: "consulted", assignedClassCount: 2 };
    const stage = BOARD_STAGES.find((s) => s.key === stageOfCard(card))!;
    expect(statusCellOf(card)).toEqual({ label: stage.label, color: stage.color });
    expect(statusCellOf(card).label).toBe("등록 완료");
  });
  it("모르는 outcome도 어딘가에 선다(칸반과 같이 '상담 전')", () => {
    expect(statusCellOf({ outcome: "???", assignedClassCount: 0 }).label).toBe("상담 전");
  });
});
