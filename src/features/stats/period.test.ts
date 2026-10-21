import { describe, expect, it } from "vitest";
import { MAX_DAY_SPAN, dayKeys, monthKeysTo, parseStatsPeriod, periodParamsOf, periodQuery, readPeriodParams } from "./period";

const TODAY = "2026-10-20";

describe("parseStatsPeriod — 통계 기간 축", () => {
  it("기본 = 월별 12개월(이번 달까지) · span=24", () => {
    const p = parseStatsPeriod({}, TODAY);
    expect(p).toEqual({ grain: "month", months: monthKeysTo(TODAY, 12) });
    expect(monthKeysTo(TODAY, 12)[0]).toBe("2025-11");
    expect(parseStatsPeriod({ span: "24" }, TODAY).grain === "month" && (parseStatsPeriod({ span: "24" }, TODAY) as { months: string[] }).months.length).toBe(24);
  });

  it("일별 한 달 — 지난 달은 말일까지 · 이번 달은 오늘까지 · 미래·잘못된 달은 이번 달", () => {
    const sep = parseStatsPeriod({ grain: "day", month: "2026-09" }, TODAY);
    expect(sep.grain === "day" && [sep.from, sep.to, sep.days.length, sep.month]).toEqual(["2026-09-01", "2026-09-30", 30, "2026-09"]);
    const oct = parseStatsPeriod({ grain: "day" }, TODAY);
    expect(oct.grain === "day" && [oct.from, oct.to, oct.days.length]).toEqual(["2026-10-01", TODAY, 20]);
    const future = parseStatsPeriod({ grain: "day", month: "2026-12" }, TODAY);
    expect(future.grain === "day" && future.month).toBe("2026-10");
    expect(parseStatsPeriod({ grain: "day", month: "2026-13" }, TODAY).grain === "day").toBe(true);
  });

  it("일별 구간 — 뒤집힌 순서는 바로잡고 · 오늘에서 멈추고 · 31일을 넘으면 시작일부터 자른다", () => {
    const r = parseStatsPeriod({ grain: "day", from: "2026-10-14", to: "2026-09-15" }, TODAY);
    expect(r.grain === "day" && [r.from, r.to, r.days.length, r.month, r.clipped]).toEqual(["2026-09-15", "2026-10-14", 30, null, false]);
    const long = parseStatsPeriod({ grain: "day", from: "2026-08-01", to: "2026-10-30" }, TODAY);
    expect(long.grain === "day" && [long.to, long.days.length, long.clipped]).toEqual(["2026-08-31", MAX_DAY_SPAN, true]);
    const fut = parseStatsPeriod({ grain: "day", from: "2026-10-10", to: "2026-11-30" }, TODAY);
    expect(fut.grain === "day" && fut.to).toBe(TODAY);
  });

  it("dayKeys · periodQuery", () => {
    expect(dayKeys("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(periodQuery({ grain: "day", month: "2026-09" }, { subject: "math", month: "2026-01", embed: "1" })).toBe("?subject=math&embed=1&grain=day&month=2026-09");
    // month와 from/to는 함께 싣지 않는다 — 구간이 있으면 구간.
    expect(periodQuery({ grain: "day", month: "2026-09", from: "2026-09-02", to: "2026-09-09" })).toBe("?grain=day&from=2026-09-02&to=2026-09-09");
  });

  it("주소 이름 매핑 — 목록 필터 `month`와 겹치지 않게", () => {
    const keys = { grain: "trend", month: "trendMonth", from: "trendFrom", to: "trendTo", span: "trendSpan" };
    const sp = { view: "stats", month: "2026-01", trend: "day", trendMonth: "2026-09" };
    expect(readPeriodParams(sp, keys)).toEqual({ grain: "day", month: "2026-09", from: undefined, to: undefined, span: undefined });
    expect(periodQuery({ grain: "day", month: "2026-08" }, { view: "stats", month: "2026-01", trendMonth: "2026-09" }, keys)).toBe("?view=stats&month=2026-01&trend=day&trendMonth=2026-08");
    const p = parseStatsPeriod(readPeriodParams(sp, keys), TODAY);
    expect(periodParamsOf(p)).toEqual({ grain: "day", month: "2026-09" });
    expect(periodParamsOf(parseStatsPeriod({ span: "24" }, TODAY))).toEqual({ span: "24" });
  });
});

import { hasPeriodParams, paramsForMode, periodModeOf } from "./period";

describe("보기 방식(계정 귀속)", () => {
  it("방식 ↔ 기간 — 구간은 오늘까지 30일 · 주소에 기간이 없을 때만 저장값", () => {
    for (const mode of ["month", "month24", "day", "range"] as const) expect(periodModeOf(parseStatsPeriod(paramsForMode(mode, TODAY), TODAY))).toBe(mode);
    const r = parseStatsPeriod(paramsForMode("range", TODAY), TODAY);
    expect(r.grain === "day" && [r.from, r.to, r.days.length]).toEqual(["2026-09-21", TODAY, 30]);
    expect(hasPeriodParams({})).toBe(false);
    expect(hasPeriodParams({ month: "2026-09" })).toBe(true);
  });
});
