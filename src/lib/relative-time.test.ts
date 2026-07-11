import { describe, it, expect } from "vitest";
import { relativeTimeKo, relativeDayKo } from "./relative-time";

// 고정 now: 2026-07-11T12:00:00Z 기준 경계값 검증(nowMs 주입).
const NOW = Date.parse("2026-07-11T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

describe("relativeTimeKo", () => {
  it("1분 미만 = 방금 전", () => {
    expect(relativeTimeKo(ago(0), NOW)).toBe("방금 전");
    expect(relativeTimeKo(ago(59 * 1000), NOW)).toBe("방금 전");
  });
  it("분 단위", () => {
    expect(relativeTimeKo(ago(1 * MIN), NOW)).toBe("1분 전");
    expect(relativeTimeKo(ago(59 * MIN), NOW)).toBe("59분 전");
  });
  it("60분 = 1시간 전 (분→시 경계)", () => {
    expect(relativeTimeKo(ago(60 * MIN), NOW)).toBe("1시간 전");
  });
  it("시간 단위 — 24시간 미만은 '0일 전' 아니라 시간", () => {
    expect(relativeTimeKo(ago(1 * HR), NOW)).toBe("1시간 전");
    expect(relativeTimeKo(ago(23 * HR + 59 * MIN), NOW)).toBe("23시간 전");
  });
  it("24시간 = 1일 전 (시→일 경계, 원장 요구 핵심)", () => {
    expect(relativeTimeKo(ago(24 * HR), NOW)).toBe("1일 전");
  });
  it("일 단위 (7일 미만)", () => {
    expect(relativeTimeKo(ago(2 * DAY), NOW)).toBe("2일 전");
    expect(relativeTimeKo(ago(6 * DAY), NOW)).toBe("6일 전");
  });
  it("7일 이상 = 절대 날짜", () => {
    expect(relativeTimeKo(ago(7 * DAY), NOW)).toMatch(/2026/);
  });
  it("null·빈값·파싱실패 = 빈 문자열", () => {
    expect(relativeTimeKo(null, NOW)).toBe("");
    expect(relativeTimeKo(undefined, NOW)).toBe("");
    expect(relativeTimeKo("not-a-date", NOW)).toBe("");
  });
  it("미래 시각 = 방금 전(시계 오차 방어)", () => {
    expect(relativeTimeKo(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe("방금 전");
  });
});

describe("relativeDayKo (날짜 전용 — 오늘/어제/N일 전)", () => {
  const TODAY = "2026-07-11";
  it("당일 = 오늘 ('0일 전' 아님)", () => {
    expect(relativeDayKo("2026-07-11", TODAY)).toBe("오늘");
  });
  it("전날 = 어제", () => {
    expect(relativeDayKo("2026-07-10", TODAY)).toBe("어제");
  });
  it("2~6일 = N일 전", () => {
    expect(relativeDayKo("2026-07-09", TODAY)).toBe("2일 전");
    expect(relativeDayKo("2026-07-05", TODAY)).toBe("6일 전");
  });
  it("7일 이상 = 원본 날짜", () => {
    expect(relativeDayKo("2026-07-04", TODAY)).toBe("2026-07-04");
  });
  it("미래 날짜 = 오늘(음수 방어)", () => {
    expect(relativeDayKo("2026-07-15", TODAY)).toBe("오늘");
  });
  it("null·빈값 = 빈 문자열", () => {
    expect(relativeDayKo(null, TODAY)).toBe("");
    expect(relativeDayKo("", TODAY)).toBe("");
  });
});
