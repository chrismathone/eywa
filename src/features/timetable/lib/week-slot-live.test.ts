import { describe, expect, it } from "vitest";
import { dateOfDowInWeek, slotLiveOnDate } from "./week";

// 2026-08-04(화)가 속한 주: 월 08-03 ~ 일 08-09
describe("dateOfDowInWeek", () => {
  it("그 주의 실제 날짜를 준다", () => {
    expect(dateOfDowInWeek("2026-08-04", "mon")).toBe("2026-08-03");
    expect(dateOfDowInWeek("2026-08-04", "wed")).toBe("2026-08-05");
    expect(dateOfDowInWeek("2026-08-04", "sun")).toBe("2026-08-09");
  });
  it("모르는 요일 키는 null", () => {
    expect(dateOfDowInWeek("2026-08-04", "xxx")).toBeNull();
  });
});

describe("slotLiveOnDate — 날짜 단위 유효 판정(변경 주 중복 방지)", () => {
  const old = { dayOfWeek: "mon", validFrom: "2026-01-01", validTo: "2026-08-03" }; // 어제까지
  const now = { dayOfWeek: "mon", validFrom: "2026-08-04", validTo: null }; // 오늘부터

  it("🔴 같은 요일 칸에 옛 행과 새 행이 동시에 살아 있지 않다", () => {
    const ref = "2026-08-04";
    const live = [old, now].filter((s) => slotLiveOnDate(s, ref));
    expect(live).toHaveLength(1);
  });

  it("변경 전 주를 보면 옛 배치가, 다음 주를 보면 새 배치가 나온다", () => {
    expect(slotLiveOnDate(old, "2026-07-28")).toBe(true); // 지난 주 월요일 = 07-27
    expect(slotLiveOnDate(now, "2026-07-28")).toBe(false);
    expect(slotLiveOnDate(old, "2026-08-11")).toBe(false); // 다음 주 월요일 = 08-10
    expect(slotLiveOnDate(now, "2026-08-11")).toBe(true);
  });

  it("변경 주에도 요일마다 갈린다 — 월요일(08-03)은 옛 배치", () => {
    // 월요일 칸의 날짜는 08-03이라 '어제까지'인 옛 행이 이긴다(실제로 그날은 옛 담당이었다).
    expect(slotLiveOnDate({ ...old, dayOfWeek: "mon" }, "2026-08-04")).toBe(true);
    // 수요일 칸(08-05)은 새 행.
    expect(slotLiveOnDate({ ...old, dayOfWeek: "wed" }, "2026-08-04")).toBe(false);
    expect(slotLiveOnDate({ ...now, dayOfWeek: "wed" }, "2026-08-04")).toBe(true);
  });

  it("유효기간이 없으면 항상 통과(판정 불가를 '없음'으로 바꾸지 않는다)", () => {
    expect(slotLiveOnDate({ dayOfWeek: "fri" }, "2026-08-04")).toBe(true);
  });
});
