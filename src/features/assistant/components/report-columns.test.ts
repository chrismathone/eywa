import { describe, expect, it } from "vitest";
import { FIXED_MAX, FLEX_MIN, fitColumn, mayOverflow, oneLine, tableMinWidth, twoLineWidth } from "./report-columns";

describe("보고서 표 열 폭", () => {
  it("짧은 열은 가장 긴 값에 맞춘 고정 폭", () => {
    const fit = fitColumn("학년", ["중1", "초4", "중3"]);
    expect(fit.width).not.toBeNull();
    expect(fit.width!).toBeLessThanOrEqual(FIXED_MAX);
  });
  it("긴 글 열(메모)은 고정하지 않고 남은 폭을 쓴다", () => {
    expect(fitColumn("퇴원 메모", ["학생이 학원을 그만두는 이유를 길게 적은 메모입니다 담임이 바뀌어서 그렇다고 합니다"]).width).toBeNull();
  });
  it("표 최소 폭 = 고정 합 + 긴 글 열 최소 폭", () => {
    expect(tableMinWidth([{ width: 80 }, { width: null }])).toBe(80 + FLEX_MIN);
  });
  it("줄바꿈은 한 줄로 잇고, 넘칠 수 있는 칸만 카드를 단다", () => {
    expect(oneLine("첫 줄\n\n둘째 줄")).toBe("첫 줄 · 둘째 줄");
    expect(mayOverflow("짧음", { width: 80 })).toBe(false);
    expect(mayOverflow("가\n나", { width: 80 })).toBe(true);
    expect(mayOverflow("긴 메모가 이어집니다 긴 메모가 이어집니다 긴 메모", { width: null })).toBe(true);
  });
  it("머리가 값보다 훨씬 길면 열은 값에 맞추고 머리를 두 줄로 접는다(원장 2026-11-11 '열너비도 스마트하게')", () => {
    const head = "재직 상태(지금 기준 · 퇴사 포함)";
    const fit = fitColumn(head, ["재직", "퇴사", "재직"]);
    expect(fit.wrapHead).toBe(true);
    expect(fit.width!).toBeLessThan(fitColumn(head, ["재직 상태(지금 기준 · 퇴사 포함) 길이의 값입니다"]).width ?? Infinity);
    // 짧은 머리는 접지 않는다
    expect(fitColumn("학년", ["중1"]).wrapHead).toBeUndefined();
    expect(fitColumn("담당 학생", ["387"]).wrapHead).toBeUndefined();
  });
  it("두 줄로 접은 머리는 어절 단위로 실제 두 줄에 들어간다(16px · 최종 리뷰 2026-11-11 — 예전 계산은 세 줄이 필요했다)", () => {
    const head = "10월 담당 학생 수";
    const fit = fitColumn(head, ["12", "3"]);
    if (fit.wrapHead) expect(fit.width!).toBeGreaterThanOrEqual(twoLineWidth(head)! + 42);
    // 어절 하나뿐인 긴 머리는 접지 않는다
    expect(twoLineWidth("담당학생수분모포함")).toBeNull();
    expect(fitColumn("담당학생수분모포함기준", ["3"]).wrapHead).toBeUndefined();
    // 가장 고른 나눔: '10월 담당' | '학생 수'
    expect(twoLineWidth(head)).toBe(Math.max(2 * 9 + 16 + 9 + 2 * 16, 2 * 16 + 9 + 16));
  });
});
