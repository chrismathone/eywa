import { describe, expect, it } from "vitest";
import { DAY_TONE, cellDisplay, markNumber } from "./cell-display";

describe("markNumber", () => {
  it("결석은 언제나 0(시수를 소비하지 않음)", () => {
    expect(markNumber("absent", null)).toBe("0");
    expect(markNumber("absent", 2)).toBe("0");
    expect(markNumber("excused", null)).toBe("0");
  });
  it("출석·지각·조퇴·보강은 시수(미입력=1)", () => {
    expect(markNumber("present", null)).toBe("1");
    expect(markNumber("late", null)).toBe("1");
    expect(markNumber("early_leave", null)).toBe("1");
    expect(markNumber("makeup", null)).toBe("1");
  });
  it("배수는 그대로 표기(1.5·2)", () => {
    expect(markNumber("present", 1.5)).toBe("1.5");
    expect(markNumber("makeup", 2)).toBe("2");
  });
  it("이상값(0·음수·NaN)은 기본 1로", () => {
    expect(markNumber("present", 0)).toBe("1");
    expect(markNumber("present", Number.NaN)).toBe("1");
  });
});

describe("cellDisplay", () => {
  it("상태별 배경색 — 지각 주황·결석 빨강·보강 연보라·조퇴 연파랑", () => {
    expect(cellDisplay("late", null).className).toContain("bg-amber");
    expect(cellDisplay("absent", null).className).toContain("bg-danger");
    expect(cellDisplay("makeup", null).className).toContain("bg-purple");
    expect(cellDisplay("early_leave", null).className).toContain("bg-blue");
    expect(cellDisplay("present", null).className).toContain("bg-primary-soft");
  });
  it("수업하는 요일은 민트, 주말·휴일은 회색, 수업 없는 평일은 흰색(배경 클래스 없음)", () => {
    expect(cellDisplay(null, null, { attendDay: true }).className).toContain(DAY_TONE.classDay);
    expect(cellDisplay(null, null, { muted: true }).className).toContain(DAY_TONE.weekend);
    expect(cellDisplay(null, null).className).not.toContain("bg-");
  });
  it("기록 없는 칸은 가운뎃점", () => {
    expect(cellDisplay(null, null).text).toBe("·");
  });
  it("공휴일(muted)이라도 기록이 있으면 상태색이 이긴다", () => {
    expect(cellDisplay("absent", null, { muted: true }).className).toContain("bg-danger");
  });
});
