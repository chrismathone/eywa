import { describe, expect, it } from "vitest";
import { inPreviousDays, previousDayRange, previousDayText } from "./previous-day";

// 원장 2026-10-22 *"월요일의 전일은 주말 모두 포함"* — '전일 입테'·'전일 / 이달 신규'가 같은 기간을 쓴다.
describe("운영실 '전일' 기간", () => {
  it("평일·주말은 어제 하루 · 월요일은 토·일", () => {
    expect(previousDayRange("2026-10-22")).toEqual({ from: "2026-10-21", to: "2026-10-21" }); // 목
    expect(previousDayRange("2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-10-26" }); // 화
    expect(previousDayRange("2026-10-25")).toEqual({ from: "2026-10-24", to: "2026-10-24" }); // 일
    expect(previousDayRange("2026-10-26")).toEqual({ from: "2026-10-24", to: "2026-10-25" }); // 월
    expect(previousDayRange("2026-11-02")).toEqual({ from: "2026-10-31", to: "2026-11-01" }); // 월 · 달을 넘는다
  });

  it("화면 글자 · 기간 안 판정", () => {
    expect(previousDayText({ from: "2026-10-21", to: "2026-10-21" })).toBe("10/21");
    expect(previousDayText({ from: "2026-10-24", to: "2026-10-25" })).toBe("주말 10/24~10/25");
    const mon = previousDayRange("2026-10-26");
    expect(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"].filter((d) => inPreviousDays(d, mon))).toEqual(["2026-10-24", "2026-10-25"]);
  });
});
