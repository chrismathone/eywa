import { describe, expect, it } from "vitest";
import { isClassSeedableInMonth, isScheduleLiveInMonth, planMonthWindow } from "./month-window";

/**
 * 시드의 "그 달에 유효한 슬롯" 판정 — 경계가 하루라도 어긋나면 달 중간에 바뀐 배치가 통째로 사라지거나
 * 아직 시작도 안 한 반이 계획에 끼어든다. 규칙을 여기서 잠근다.
 */
describe("planMonthWindow", () => {
  it("31일·30일·2월 말일을 정확히 잡는다", () => {
    expect(planMonthWindow("2026-01")).toEqual({ first: "2026-01-01", last: "2026-01-31" });
    expect(planMonthWindow("2026-09")).toEqual({ first: "2026-09-01", last: "2026-09-30" });
    expect(planMonthWindow("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
  });

  it("윤년 2월은 29일", () => {
    expect(planMonthWindow("2028-02")?.last).toBe("2028-02-29");
  });

  it("형식이 아니면 null", () => {
    expect(planMonthWindow("2026-9")).toBeNull();
    expect(planMonthWindow("2026-13")).toBeNull();
    expect(planMonthWindow("2026-00")).toBeNull();
    expect(planMonthWindow("")).toBeNull();
  });
});

describe("isScheduleLiveInMonth", () => {
  const month = "2026-09"; // 09-01 ~ 09-30

  it("valid_to가 null이면 시작일만 본다(미래 달도 계속 유효)", () => {
    expect(isScheduleLiveInMonth({ validFrom: "2025-03-01", validTo: null }, month)).toBe(true);
    expect(isScheduleLiveInMonth({ validFrom: "2026-09-30", validTo: null }, month)).toBe(true);
    // 다음 달에 시작 = 이 달의 시간표가 아니다
    expect(isScheduleLiveInMonth({ validFrom: "2026-10-01", validTo: null }, month)).toBe(false);
  });

  it("달 중간에 시작·종료해도 하루라도 겹치면 유효(기준일 하나로 자르지 않는다)", () => {
    // 9/15에 새로 열린 행 — 9월 1일 기준으로만 보면 사라졌을 것
    expect(isScheduleLiveInMonth({ validFrom: "2026-09-15", validTo: null }, month)).toBe(true);
    // 9/14에 마감된 옛 행 — 9월 말일 기준으로만 보면 사라졌을 것
    expect(isScheduleLiveInMonth({ validFrom: "2026-01-01", validTo: "2026-09-14" }, month)).toBe(true);
  });

  it("경계 하루 — 말일 시작·1일 종료는 포함, 그 하루 밖은 제외", () => {
    expect(isScheduleLiveInMonth({ validFrom: "2026-09-30", validTo: "2026-09-30" }, month)).toBe(true);
    expect(isScheduleLiveInMonth({ validFrom: "2026-08-01", validTo: "2026-09-01" }, month)).toBe(true);
    expect(isScheduleLiveInMonth({ validFrom: "2026-08-01", validTo: "2026-08-31" }, month)).toBe(false);
    expect(isScheduleLiveInMonth({ validFrom: "2026-10-01", validTo: "2026-12-31" }, month)).toBe(false);
  });

  it("valid_from이 없으면 담지 않는다(모르면 새어 나가지 않는 쪽)", () => {
    expect(isScheduleLiveInMonth({ validFrom: null, validTo: null }, month)).toBe(false);
  });

  it("달 형식이 깨지면 무조건 false", () => {
    expect(isScheduleLiveInMonth({ validFrom: "2020-01-01", validTo: null }, "2026-9")).toBe(false);
  });
});

describe("isClassSeedableInMonth", () => {
  const month = "2026-09";

  it("폐지된 반은 제외", () => {
    expect(isClassSeedableInMonth({ isActive: false, closedAt: null }, month)).toBe(false);
  });

  it("그 달 전에 종강한 반은 제외, 달 안에 종강하면 포함", () => {
    expect(isClassSeedableInMonth({ isActive: true, closedAt: "2026-08-31" }, month)).toBe(false);
    expect(isClassSeedableInMonth({ isActive: true, closedAt: "2026-09-01" }, month)).toBe(true);
    expect(isClassSeedableInMonth({ isActive: true, closedAt: "2026-09-20" }, month)).toBe(true);
    expect(isClassSeedableInMonth({ isActive: true, closedAt: "2026-12-31" }, month)).toBe(true);
  });

  it("is_active를 모르면(null) 지우지 않는다", () => {
    expect(isClassSeedableInMonth({ isActive: null, closedAt: null }, month)).toBe(true);
  });
});
