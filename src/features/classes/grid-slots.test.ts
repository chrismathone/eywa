import { describe, expect, it } from "vitest";
import { splitGridSlots } from "./grid-slots";

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
