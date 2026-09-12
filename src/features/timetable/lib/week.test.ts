import { describe, it, expect } from "vitest";
import {
  mondayOf,
  thisMonday,
  addWeeks,
  shiftDays,
  getWeekReferenceDate,
  weekEndOf,
  weekBoundsOf,
  weekSundayOf,
  slotLiveOnDate,
  weekLabel,
  compactWeekLabel,
  weekTitle,
  weekRelation,
} from "./week";

it.each([
  ["2026-09-07", "26.09.07–13"],
  ["2026-09-28", "26.09.28–10.04"],
  ["2026-12-28", "26.12.28–01.03"],
  ["2028-02-28", "28.02.28–03.05"],
])("모바일 주간 라벨은 월·연도·윤년 경계에서도 같은 7일을 표시한다: %s", (monday, label) => {
  expect(compactWeekLabel(monday)).toBe(label);
});

describe("week — 주(週) 경계 계산", () => {
  it("mondayOf: 금요일 → 그 주 월요일", () => {
    expect(mondayOf("2026-06-26")).toBe("2026-06-22"); // 금
  });
  it("mondayOf: 월요일 → 그대로", () => {
    expect(mondayOf("2026-06-22")).toBe("2026-06-22");
  });
  it("mondayOf: 일요일 → 직전 월요일(-6)", () => {
    expect(mondayOf("2026-06-28")).toBe("2026-06-22");
  });
  it("addWeeks / shiftDays", () => {
    expect(addWeeks("2026-06-22", 1)).toBe("2026-06-29");
    expect(addWeeks("2026-06-22", -2)).toBe("2026-06-08");
    expect(shiftDays("2026-06-22", 6)).toBe("2026-06-28");
  });
  it("thisMonday", () => {
    expect(thisMonday("2026-06-26")).toBe("2026-06-22");
  });
});

describe("getWeekReferenceDate — ijw 3분기", () => {
  const today = "2026-06-26"; // 금, thisMonday=06-22
  it("이번 주 → 오늘", () => {
    expect(getWeekReferenceDate("2026-06-22", today)).toBe("2026-06-26");
  });
  it("과거 주 → 그 주 일요일", () => {
    // 06-08 주(월) → weekEnd 06-14, today 06-26 > 06-14 → 과거 → 06-14
    expect(getWeekReferenceDate("2026-06-08", today)).toBe("2026-06-14");
  });
  it("미래 주 → 그 주 월요일", () => {
    expect(getWeekReferenceDate("2026-07-06", today)).toBe("2026-07-06");
  });
  it("weekEndOf = ref+6", () => {
    expect(weekEndOf("2026-06-26")).toBe("2026-07-02");
    expect(weekEndOf("2026-06-14")).toBe("2026-06-20");
  });
  it("weekSundayOf = 그 주 실제 일요일 (롤링 창 아님)", () => {
    expect(weekSundayOf("2026-06-28")).toBe("2026-06-28"); // 과거 주 ref=일요일 → 자기 자신
    expect(weekSundayOf("2026-07-03")).toBe("2026-07-05"); // 금요일 → 그 주 일요일
    expect(weekSundayOf("2026-07-06")).toBe("2026-07-12"); // 미래 주 ref=월요일 → +6
    // 스케줄 전환(temporal cutover) 시나리오: valid_from=07-03이 직전 과거 주(ref 06-28)에 새면 안 됨
    expect(weekSundayOf("2026-06-28") < "2026-07-03").toBe(true);
    expect(weekEndOf("2026-06-28") >= "2026-07-03").toBe(true); // 옛 롤링 창은 샜음(버그 근거)
  });
  it("weekBoundsOf = 기준일이 속한 월요일~일요일", () => {
    expect(weekBoundsOf("2026-08-13")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });
  it("주중 스케줄 전환 시 요일 날짜마다 옛 행/새 행을 정확히 고른다", () => {
    // LS6 실측: 목요일(8/13)에 새 시간표를 저장했어도 화요일(8/11)은 8/12까지 유효한 옛 LAB 행이다.
    expect(
      slotLiveOnDate({ dayOfWeek: "tue", validFrom: "2026-08-03", validTo: "2026-08-12" }, "2026-08-13"),
    ).toBe(true);
    expect(
      slotLiveOnDate({ dayOfWeek: "tue", validFrom: "2026-08-13", validTo: null }, "2026-08-13"),
    ).toBe(false);
    expect(
      slotLiveOnDate({ dayOfWeek: "thu", validFrom: "2026-08-13", validTo: null }, "2026-08-13"),
    ).toBe(true);
  });
});

describe("weekLabel — 주차 라벨", () => {
  it("달 안 — 2026년 6월 4주차 (22~28일)", () => {
    expect(weekLabel("2026-06-22")).toBe("2026년 6월 4주차 (22~28일)");
  });
  it("달 경계 — 29~7/5일", () => {
    expect(weekLabel("2026-06-29")).toBe("2026년 6월 5주차 (29~7/5일)");
  });
  it("🔴 범위 앞에 '일'을 다시 붙이지 않는다 — 그 한 글자가 툴바를 두 줄로 만든다", () => {
    // 폭이 `WEEK_LABEL_W`(205 = 287px)에 맞춰져 있고, 감싸는 상자가 overflow-hidden이라
    // 포맷이 길어지면 **에러 없이 날짜가 잘린다**. 되돌릴 땐 폭도 함께 재고 올릴 것.
    expect(weekLabel("2026-10-26")).toBe("2026년 10월 5주차 (26~11/1일)");
    expect(weekLabel("2026-06-22")).not.toContain("일~");
  });
  it("weekTitle — 문장에 끼울 이름만(범위 없이). weekLabel의 앞부분과 항상 같다", () => {
    expect(weekTitle("2026-06-22")).toBe("2026년 6월 4주차");
    expect(weekLabel("2026-06-29").startsWith(weekTitle("2026-06-29"))).toBe(true);
  });
});

describe("weekRelation", () => {
  const today = "2026-06-26";
  it("현재/과거/미래", () => {
    expect(weekRelation("2026-06-22", today)).toBe("current");
    expect(weekRelation("2026-06-08", today)).toBe("past");
    expect(weekRelation("2026-07-06", today)).toBe("future");
  });
});
