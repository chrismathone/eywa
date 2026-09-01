import { describe, expect, it } from "vitest";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { fillPct, holidayNameOn, isHolidayOn, tallyHolidayFill } from "./holiday";

/**
 * 휴일 규약 — ECS·MCS가 공유하는 유일한 판정. 규약 자체는 report-admin/writing-rate.ts의 휴일 분기를
 * 옮긴 것이라(원장 2026-07-22), 여기서 지키는 세 문장이 그 파일의 주석과 **글자 그대로 같아야** 한다.
 */
describe("holidayNameOn / isHolidayOn — 학원설정이 단일 소스", () => {
  const map = buildHolidayMap([
    { date: "2026-09-24", name: "추석 연휴" },
    { date: "2026-09-25", name: "추석" },
    { date: "2026-08-17", name: "" }, // 이름이 비면 buildHolidayMap이 "휴일"로 채운다
  ]);

  it("등록된 날은 이름을, 아닌 날은 null을 준다", () => {
    expect(holidayNameOn(map, "2026-09-25")).toBe("추석");
    expect(holidayNameOn(map, "2026-09-23")).toBeNull();
    expect(isHolidayOn(map, "2026-09-24")).toBe(true);
    expect(isHolidayOn(map, "2026-09-23")).toBe(false);
  });

  it("이름이 비어 있어도 휴일은 휴일이다(폴백 '휴일')", () => {
    expect(holidayNameOn(map, "2026-08-17")).toBe("휴일");
  });

  it("🔴 맵이 없으면(미설정·조회 실패) 전부 평일이다 — 없는 휴일을 지어내지 않는다", () => {
    expect(isHolidayOn(null, "2026-09-25")).toBe(false);
    expect(isHolidayOn(undefined, "2026-09-25")).toBe(false);
    expect(holidayNameOn({}, "2026-09-25")).toBeNull();
  });

  it("🔴 내장 법정공휴일 표를 안 본다 — 설정에 없으면 평일이다(학원이 공휴일에 수업한다)", () => {
    // 2026-03-01 삼일절은 features/calendar/holidays.ts에는 있지만 이 설정엔 없다.
    expect(isHolidayOn(map, "2026-03-01")).toBe(false);
  });
});

describe("tallyHolidayFill — 안 쓴 휴일=분모 밖 · 쓴 휴일=100% 인정 · 평일 불변", () => {
  it("🔴 안 쓴 휴일은 분모에도 분자에도 안 들어간다", () => {
    const fill = tallyHolidayFill([{ holiday: true, written: false }]);
    expect(fill).toEqual({ total: 0, filled: 0, holidayWritten: 0, holidayIdle: 1 });
    expect(fillPct(fill)).toBe(0);
  });

  it("🔴 쓴 휴일은 대상=작성이라 100%다 — 감점되지 않고 '한 일로 인정'된다", () => {
    const fill = tallyHolidayFill([{ holiday: true, written: true }]);
    expect(fill).toEqual({ total: 1, filled: 1, holidayWritten: 1, holidayIdle: 0 });
    expect(fillPct(fill)).toBe(100);
  });

  it("🔴 평일은 종전 그대로 — 쓰면 분자, 안 쓰면 분모만", () => {
    const fill = tallyHolidayFill([
      { holiday: false, written: true },
      { holiday: false, written: false },
    ]);
    expect(fill).toEqual({ total: 2, filled: 1, holidayWritten: 0, holidayIdle: 0 });
    expect(fillPct(fill)).toBe(50);
  });

  it("🔴 안 쓴 휴일이 섞여도 평일 작성률을 **깎지 않는다**(추석이 낀 달의 담임이 나빠 보이면 안 된다)", () => {
    const weekdaysOnly = tallyHolidayFill([
      { holiday: false, written: true },
      { holiday: false, written: true },
    ]);
    const withIdleHolidays = tallyHolidayFill([
      { holiday: false, written: true },
      { holiday: false, written: true },
      { holiday: true, written: false },
      { holiday: true, written: false },
      { holiday: true, written: false },
    ]);
    expect(fillPct(withIdleHolidays)).toBe(fillPct(weekdaysOnly));
    expect(fillPct(withIdleHolidays)).toBe(100);
    expect(withIdleHolidays.total).toBe(2); // 휴일 3칸은 분모 밖
    expect(withIdleHolidays.holidayIdle).toBe(3);
  });

  it("🔴 쓴 휴일이 작성률을 **부풀리지도 않는다** — 100% 기여라 평균을 위로 끌지 못한다", () => {
    const before = tallyHolidayFill([
      { holiday: false, written: true },
      { holiday: false, written: false },
    ]);
    const after = tallyHolidayFill([
      { holiday: false, written: true },
      { holiday: false, written: false },
      { holiday: true, written: true },
    ]);
    expect(fillPct(before)).toBe(50);
    // 1/2 → 2/3. 100%가 아니라 **그 칸 하나만큼** 올라간다(휴일이라고 전체를 100으로 만들지 않는다).
    expect(after).toEqual({ total: 3, filled: 2, holidayWritten: 1, holidayIdle: 0 });
    expect(fillPct(after)).toBe(67);
  });

  it("빈 입력은 0/0 — 나눗셈이 터지지 않는다", () => {
    expect(tallyHolidayFill([])).toEqual({ total: 0, filled: 0, holidayWritten: 0, holidayIdle: 0 });
    expect(fillPct({ filled: 0, total: 0 })).toBe(0);
  });
});
