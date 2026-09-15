import { describe, expect, it } from "vitest";
import { cellBoxClass, cellMarkOf, STATUS_STYLE } from "./cell-display";
import { ONBOARDING_ITEMS, progressOf, type OnboardingItemStatus } from "./onboarding-items";

const ALL: OnboardingItemStatus[] = ["done", "overdue", "due", "upcoming", "pending", "waived"];
describe("업무 상태 표시", () => {
  it("완료·미정·관리 제외를 빈칸 없이 구분한다", () => {
    expect(cellMarkOf("done", 10)).toEqual({ kind: "check" });
    expect(cellMarkOf("pending", null)).toEqual({ kind: "text", text: "미정" });
    expect(cellMarkOf("waived", -40)).toEqual({ kind: "text", text: "제외" });
  });
  it("달력일의 D-day와 오늘을 그대로 표시한다", () => {
    expect(cellMarkOf("overdue", -9)).toEqual({ kind: "text", text: "D+9" });
    expect(cellMarkOf("due", 0)).toEqual({ kind: "text", text: "오늘" });
    expect(cellMarkOf("upcoming", 29)).toEqual({ kind: "text", text: "D-29" });
    expect(cellMarkOf("due", null)).toEqual({ kind: "text", text: "미정" });
    for (const status of ALL) for (let d = -60; d <= 120; d++) {
      const mark = cellMarkOf(status, d);
      if (mark.kind === "text") expect(mark.text).not.toBe("D-0");
    }
  });
  it("모든 상태에 설명이 있고 오늘·임박·지연·완료는 구분된다", () => {
    for (const status of ALL) expect(STATUS_STYLE[status].label).toBeTruthy();
    expect(new Set([cellBoxClass("overdue", false), cellBoxClass("due", false, 0), cellBoxClass("due", false, 3), cellBoxClass("done", false)]).size).toBe(4);
    expect(cellBoxClass("waived", false)).not.toBe(cellBoxClass("overdue", false));
  });
  it("선택 업무는 중립색이며 완료한 경우만 완료 표시를 받는다", () => {
    expect(ONBOARDING_ITEMS.filter(i => i.optional).map(i => i.key)).toEqual(["month2_call"]);
    for (const status of ["overdue", "due", "pending", "waived"] as const) expect(cellBoxClass(status, true, 0)).toBe(cellBoxClass("upcoming", true));
    expect(cellBoxClass("done", true)).toBe(cellBoxClass("done", false));
  });
  it("기준일 이전 표시 변경이 집계를 바꾸지 않는다", () => {
    expect(progressOf({ enrolledOn: "2026-06-01", firstClassOn: "2026-06-05" }, {}, "2026-09-10")).toEqual({ dueTotal: 0, doneCount: 0, overdue: 0, dueSoon: 0, rate: 100 });
  });
});
