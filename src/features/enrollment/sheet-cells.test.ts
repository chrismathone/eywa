import { describe, expect, it } from "vitest";
import { BOARD_STAGES, stageOfCard } from "./board-stages";
import { SHEET_LEGEND, sheetDate, statusCellOf } from "./sheet-cells";

describe("시트 날짜 표기 — M/D", () => {
  it("YYYY-MM-DD를 시트의 M/D로 적는다(0을 뗀다)", () => {
    expect(sheetDate("2026-08-05")).toBe("8/5");
    expect(sheetDate("2025-12-31")).toBe("12/31");
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
