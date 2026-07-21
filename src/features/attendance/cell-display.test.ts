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
  it("상태별 배경색 — 출석 민트·지각 주황·결석 빨강·조퇴 파랑·보강 보라(전용 att-* 팔레트)", () => {
    expect(cellDisplay("present", null).className).toContain("bg-att-present");
    expect(cellDisplay("late", null).className).toContain("bg-att-late");
    expect(cellDisplay("absent", null).className).toContain("bg-att-absent");
    expect(cellDisplay("early_leave", null).className).toContain("bg-att-leave");
    expect(cellDisplay("makeup", null).className).toContain("bg-att-makeup");
  });
  it("출결(1의 배경)은 쨍한 원색, 날짜(요일) 배경은 그보다 옅다 — 둘이 헷갈리면 안 된다", () => {
    // 쨍한 색은 STATUS_TONE만. 날짜 칸은 att-classday(옅은 민트)/att-weekend(회색)로 계열이 다르다.
    const presentBg = cellDisplay("present", null).className;
    const classDayBg = cellDisplay(null, null, { attendDay: true }).className;
    expect(presentBg).not.toContain(DAY_TONE.classDay);
    expect(classDayBg).not.toContain("bg-att-present ");
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
    expect(cellDisplay("absent", null, { muted: true }).className).toContain("bg-att-absent");
  });
});
