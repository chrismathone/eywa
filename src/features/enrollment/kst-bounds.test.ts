import { describe, expect, it } from "vitest";
import { kstDayBounds, kstMonthBounds } from "./kst-bounds";

describe("kstDayBounds — 접수일(created_at) 하루", () => {
  it("KST 자정 ~ 다음 날 KST 자정(끝 제외)", () => {
    expect(kstDayBounds("2026-09-11")).toEqual({
      startIso: "2026-09-10T15:00:00.000Z",
      endIso: "2026-09-11T15:00:00.000Z",
    });
  });

  it("달·해를 넘긴다", () => {
    expect(kstDayBounds("2026-12-31")).toEqual({
      startIso: "2026-12-30T15:00:00.000Z",
      endIso: "2026-12-31T15:00:00.000Z",
    });
  });

  it("KST 새벽 1시 접수는 그날에 든다(UTC로는 전날 16시)", () => {
    const { startIso, endIso } = kstDayBounds("2026-09-11");
    const at = new Date("2026-09-11T01:00:00+09:00").toISOString();
    expect(at >= startIso && at < endIso).toBe(true);
  });
});

describe("kstMonthBounds — 목록 월 필터(consulted_at)", () => {
  it("🔴 KST 1일 00:00 ~ 다음 달 KST 1일 00:00 — 서버 로컬(UTC) 자정이 아니다", () => {
    expect(kstMonthBounds("2026-09")).toEqual({
      startIso: "2026-08-31T15:00:00.000Z",
      endIso: "2026-09-30T15:00:00.000Z",
    });
  });

  it("12월 → 다음 해 1월 1일", () => {
    expect(kstMonthBounds("2026-12").endIso).toBe("2026-12-31T15:00:00.000Z");
  });

  it("9월 1일 KST 새벽 상담은 9월에 들고 8월에 새지 않는다", () => {
    const at = new Date("2026-09-01T02:00:00+09:00").toISOString();
    const sep = kstMonthBounds("2026-09");
    const aug = kstMonthBounds("2026-08");
    expect(at >= sep.startIso && at < sep.endIso).toBe(true);
    expect(at >= aug.startIso && at < aug.endIso).toBe(false);
  });
});
