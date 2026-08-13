import { describe, expect, it } from "vitest";
import { buildPeriodMatcher, splitGridSlots, type PeriodMatchRow } from "./grid-slots";

// 실측 교시표(injaewon): 평일 영어 11교시(14:20~), 주말 8교시(09:00~17:00 정시).
const WEEKDAY = [{ startTime: "14:20" }, { startTime: "16:20" }, { startTime: "17:40" }];
const WEEKEND = [{ startTime: "09:00" }, { startTime: "14:00" }, { startTime: "15:00" }];

const slot = (dayOfWeek: string, startTime: string, endTime = "17:00") => ({
  dayOfWeek,
  startTime,
  endTime,
});

describe("splitGridSlots — 클릭그리드가 표현할 수 있는 슬롯 가르기", () => {
  it("교시표에 시작시각이 있으면 그리드", () => {
    const { grid, custom } = splitGridSlots({
      slots: [slot("mon", "16:20")],
      weekdayPeriods: WEEKDAY,
      weekendPeriods: WEEKEND,
    });
    expect(grid).toHaveLength(1);
    expect(custom).toHaveLength(0);
  });

  // 🔴 실측: '고등E_고2 심화'의 토 14:20·15:40은 주말 교시표(정시)에 없어 그리드가 통째로 버렸다
  // → 저장 한 번에 영구 삭제. 자유 시각 행으로 넘겨야 살아남는다.
  it("주말 교시표에 없는 시작시각은 자유 시각 행으로", () => {
    const { grid, custom } = splitGridSlots({
      slots: [slot("sat", "14:20"), slot("sat", "15:40")],
      weekdayPeriods: WEEKDAY,
      weekendPeriods: WEEKEND,
    });
    expect(grid).toHaveLength(0);
    expect(custom.map((s) => s.startTime)).toEqual(["14:20", "15:40"]);
  });

  // 방학 오전 특강(09~14시)은 평일 교시표(14:20~)에 칸이 없다 = 클릭그리드로 못 만든다.
  it("평일 오전(특강 시간대)은 자유 시각 행으로", () => {
    const { custom } = splitGridSlots({
      slots: [slot("wed", "09:00", "12:00")],
      weekdayPeriods: WEEKDAY,
      weekendPeriods: WEEKEND,
    });
    expect(custom).toHaveLength(1);
  });

  it("평일/주말 교시표를 요일에 맞게 각각 본다", () => {
    const { grid, custom } = splitGridSlots({
      // 09:00은 주말에만, 14:20은 평일에만 있는 시각.
      slots: [slot("sun", "09:00"), slot("mon", "09:00"), slot("mon", "14:20"), slot("sat", "14:20")],
      weekdayPeriods: WEEKDAY,
      weekendPeriods: WEEKEND,
    });
    expect(grid.map((s) => `${s.dayOfWeek}${s.startTime}`)).toEqual(["sun09:00", "mon14:20"]);
    expect(custom.map((s) => `${s.dayOfWeek}${s.startTime}`)).toEqual(["mon09:00", "sat14:20"]);
  });

  it("DB의 HH:MM:SS도 교시표(HH:MM)와 맞는다", () => {
    const { grid } = splitGridSlots({
      slots: [slot("mon", "16:20:00")],
      weekdayPeriods: WEEKDAY,
      weekendPeriods: WEEKEND,
    });
    expect(grid).toHaveLength(1);
  });
});

// 실측 학원설정(injaewon 영어): EiE와 IJW 두 계열이 한 표에 섞여 **시작시각이 겹친다**.
const EIE_IJW: PeriodMatchRow[] = [
  { id: "1", startTime: "14:20", endTime: "15:00" },
  { id: "4", startTime: "16:20", endTime: "17:00" }, // EiE 4교시
  { id: "7", startTime: "16:20", endTime: "17:20" }, // IJW 1교시 — 시작이 같다
  { id: "8", startTime: "17:20", endTime: "18:10" },
];

describe("buildPeriodMatcher — 저장된 슬롯을 어느 교시 칸으로 되돌릴지", () => {
  it("시작이 같은 교시가 둘이면 종료시각으로 가른다(4교시에 찍은 수업이 7교시로 옮겨가지 않는다)", () => {
    const match = buildPeriodMatcher(EIE_IJW);
    expect(match({ startTime: "16:20", endTime: "17:00" })).toBe("4");
    expect(match({ startTime: "16:20", endTime: "17:20" })).toBe("7");
  });

  it("DB의 HH:MM:SS도 맞는다", () => {
    expect(buildPeriodMatcher(EIE_IJW)({ startTime: "16:20:00", endTime: "17:20:00" })).toBe("7");
  });

  it("종료시각이 표와 다르면 시작시각으로 폴백 — 그리드에서 사라져 삭제되는 일이 없게", () => {
    const match = buildPeriodMatcher(EIE_IJW);
    expect(match({ startTime: "16:20", endTime: "16:50" })).toBe("4"); // 먼저 나온 교시
    expect(match({ startTime: "14:20", endTime: null })).toBe("1");
  });

  it("시작시각조차 표에 없으면 null(=자유 시각 행이 맡는다)", () => {
    expect(buildPeriodMatcher(EIE_IJW)({ startTime: "09:00", endTime: "10:00" })).toBeNull();
  });
});
