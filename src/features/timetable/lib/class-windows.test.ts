import { describe, expect, it } from "vitest";

import { classWindowsFromSlots } from "./class-windows";

const slot = (over: Partial<Parameters<typeof classWindowsFromSlots>[0][number]> = {}) => ({
  classId: "c1",
  className: "LT3",
  dayOfWeek: "mon",
  startTime: "16:20:00",
  endTime: "17:00:00",
  ...over,
});

describe("classWindowsFromSlots", () => {
  it("초를 잘라 HH:MM으로 낸다(겹침 판정이 문자열 비교라 형식이 갈리면 안 된다)", () => {
    expect(classWindowsFromSlots([slot()])).toEqual([
      { classId: "c1", className: "LT3", day: "mon", start: "16:20", end: "17:00" },
    ]);
  });

  it("같은 반·요일·시각은 한 번만(합반 세그먼트·이력 분할로 여러 줄이 온다)", () => {
    const out = classWindowsFromSlots([slot(), slot(), slot({ className: "LT3" })]);
    expect(out).toHaveLength(1);
  });

  it("같은 반이라도 요일·시각이 다르면 따로 남는다", () => {
    const out = classWindowsFromSlots([slot(), slot({ dayOfWeek: "thu" }), slot({ startTime: "17:10:00" })]);
    expect(out).toHaveLength(3);
  });

  it("좌표가 빈 줄은 버린다(빈 표식은 판정을 못 하고 자리만 차지한다)", () => {
    const out = classWindowsFromSlots([
      slot({ classId: "" }),
      slot({ dayOfWeek: "" }),
      slot({ startTime: "" }),
      slot({ endTime: "" }),
    ]);
    expect(out).toEqual([]);
  });
});
