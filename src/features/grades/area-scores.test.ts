import { describe, expect, it } from "vitest";
import { areaError, areaMaxOf, areasMatch, parseAreas, sameAreas, slotHasAreas, sumAreas } from "./area-scores";
import { examSlotFromLabel, examSlotLabel, examSlotsFor } from "./exam-slots";

describe("영어 Monthly Test 영역 점수", () => {
  it("영어 월말 칸만 영역으로 적는다 — 수학 월말평가·영어 중간고사는 아니다", () => {
    expect(slotHasAreas("english", "monthly")).toBe(true);
    expect(slotHasAreas("math", "monthly")).toBe(false);
    expect(slotHasAreas("english", "midterm")).toBe(false);
  });

  it("영어에 월말 칸이 서고 이름은 Monthly Test — 수학은 그대로 월말평가", () => {
    expect(examSlotsFor("english")).toContain("monthly");
    expect(examSlotLabel("english", "monthly")).toBe("Monthly Test");
    expect(examSlotLabel("math", "monthly")).toBe("월말평가");
    expect(examSlotFromLabel("Monthly Test")).toBe("monthly");
  });

  it("총합 = 적힌 영역의 합 · 0.5점도 · 비면 null(0점과 다르다)", () => {
    expect(sumAreas({ listening: 100, reading: 100, speaking: 97.5, writing: 100 })).toBe(397.5);
    expect(sumAreas({ listening: 0 })).toBe(0);
    expect(sumAreas({})).toBeNull();
    expect(sumAreas(null)).toBeNull();
  });

  it("값 읽기 — 글자 숫자도 받고 모르는 키·빈 글자는 버린다", () => {
    expect(parseAreas({ listening: "85", reading: 80, speaking: "", foo: 3 })).toEqual({ listening: 85, reading: 80 });
    expect(parseAreas({ speaking: "" })).toBeNull();
    expect(parseAreas([1, 2])).toBeNull();
    expect(parseAreas("x")).toBeNull();
  });

  it("영역 만점 = 총합 만점 ÷ 4 · 넘거나 음수면 사유", () => {
    expect(areaMaxOf(400)).toBe(100);
    expect(areaError({ listening: 100, writing: 0 }, 400)).toBeNull();
    expect(areaError({ reading: 101 }, 400)).toContain("읽기");
    expect(areaError({ speaking: -1 }, 400)).toContain("말하기");
  });

  it("다른 경로가 총합만 고쳤으면 영역을 맞지 않는 값으로 본다", () => {
    const areas = { listening: 85, reading: 80, speaking: 60, writing: 100 };
    expect(areasMatch(325, areas)).toBe(true);
    expect(areasMatch(330, areas)).toBe(false);
    expect(areasMatch(null, areas)).toBe(false);
    expect(sameAreas(areas, { ...areas })).toBe(true);
    expect(sameAreas(areas, { ...areas, writing: 99 })).toBe(false);
    expect(sameAreas(null, {})).toBe(true);
  });
});
