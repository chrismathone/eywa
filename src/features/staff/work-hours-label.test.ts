import { describe, expect, it } from "vitest";
import { formatWorkDays, workHoursLabel } from "./work-hours-label";

describe("formatWorkDays", () => {
  it("이어진 3일 이상은 ~로", () => {
    expect(formatWorkDays(["mon", "tue", "wed", "thu", "fri"])).toBe("월~금");
    expect(formatWorkDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe("월~일");
  });
  it("띄엄띄엄·짧은 덩어리는 ·로", () => {
    expect(formatWorkDays(["mon", "wed", "fri"])).toBe("월·수·금");
    expect(formatWorkDays(["sat", "sun"])).toBe("토·일");
    expect(formatWorkDays(["sat", "mon", "tue", "wed"])).toBe("월~수·토");
  });
  it("모르는 키·중복·빈 값", () => {
    expect(formatWorkDays(["fri", "xxx", "fri"])).toBe("금");
    expect(formatWorkDays([])).toBe("");
    expect(formatWorkDays(null)).toBe("");
  });
});

describe("workHoursLabel", () => {
  const WEEK = ["mon", "tue", "wed", "thu", "fri"];
  it("요일 + 시간 한 줄", () => {
    expect(workHoursLabel(WEEK, "13:00~21:00")).toBe("월~금 13:00~21:00");
    expect(workHoursLabel(WEEK, "1-9시")).toBe("월~금 1-9시");
  });
  it("한쪽만 있으면 그쪽만, 둘 다 없으면 null", () => {
    expect(workHoursLabel(WEEK, "")).toBe("월~금");
    expect(workHoursLabel([], "13:00~21:00")).toBe("13:00~21:00");
    expect(workHoursLabel([], "  ")).toBeNull();
  });
  it("시간 글에 요일이 이미 있으면 요일을 또 붙이지 않는다", () => {
    expect(workHoursLabel(WEEK, "월~금 14:00~22:00 / 토 10:00~18:00")).toBe("월~금 14:00~22:00 / 토 10:00~18:00");
    expect(workHoursLabel(WEEK, "월요일 14시~")).toBe("월요일 14시~");
    expect(workHoursLabel(["sat"], "토 10:00~18:00")).toBe("토 10:00~18:00");
  });
  it("요일로 시작하지 않는 한글은 그대로 이어 붙인다", () => {
    expect(workHoursLabel(WEEK, "오후 1시~9시")).toBe("월~금 오후 1시~9시");
  });
});
