import { describe, it, expect } from "vitest";
import { countLeaveDays, formatLeaveDays, isLeaveKind, validateLeaveRange } from "./request-days";

// 2026-08-17(월) ~ 2026-08-22(토) = 6일, 그 사이 일요일 없음.
// 2026-08-16 = 일, 2026-08-23 = 일.

describe("차감 일수 — 일요일은 세지 않는다", () => {
  it("하루 연차", () => {
    expect(countLeaveDays("2026-08-17", "2026-08-17", "annual")).toBe(1);
  });

  it("월~토 6일", () => {
    expect(countLeaveDays("2026-08-17", "2026-08-22", "annual")).toBe(6);
  });

  it("일요일을 걸치면 그 하루가 빠진다", () => {
    // 8/17(월)~8/24(월) = 달력 8일, 일요일 8/23 하나 제외 → 7일
    expect(countLeaveDays("2026-08-17", "2026-08-24", "annual")).toBe(7);
  });

  it("일요일 하나만 고르면 0일", () => {
    expect(countLeaveDays("2026-08-16", "2026-08-16", "annual")).toBe(0);
  });

  it("반차는 하루만 0.5일 — 여러 날이면 0", () => {
    expect(countLeaveDays("2026-08-17", "2026-08-17", "half")).toBe(0.5);
    expect(countLeaveDays("2026-08-17", "2026-08-18", "half")).toBe(0);
  });

  it("역순·형식 오류는 0", () => {
    expect(countLeaveDays("2026-08-20", "2026-08-17", "annual")).toBe(0);
    expect(countLeaveDays("", "2026-08-17", "annual")).toBe(0);
    expect(countLeaveDays("2026-8-17", "2026-08-17", "annual")).toBe(0);
  });
});

describe("신청 검증", () => {
  it("정상 신청은 통과", () => {
    expect(validateLeaveRange({ start: "2026-08-17", end: "2026-08-19", kind: "annual" })).toBeNull();
  });

  it("날짜 미입력·역순", () => {
    expect(validateLeaveRange({ start: "", end: "", kind: "annual" })).toBe("휴가 날짜를 선택하세요");
    expect(validateLeaveRange({ start: "2026-08-20", end: "2026-08-17", kind: "annual" })).toBe(
      "종료일이 시작일보다 앞섭니다",
    );
  });

  it("반차는 하루만", () => {
    expect(validateLeaveRange({ start: "2026-08-17", end: "2026-08-18", kind: "half" })).toBe(
      "반차는 하루만 신청할 수 있습니다",
    );
  });

  it("31일을 넘는 기간은 거른다", () => {
    expect(
      validateLeaveRange({ start: "2026-08-01", end: "2026-09-05", kind: "annual" }),
    ).toContain("최대 31일");
  });

  it("연차 사용 기간을 넘어가면 나눠 신청하라고 알린다", () => {
    const msg = validateLeaveRange({
      start: "2026-08-14",
      end: "2026-08-20",
      kind: "annual",
      periodEnd: "2026-08-15",
    });
    expect(msg).toContain("2026-08-15까지");
  });

  it("일요일만 고른 신청은 차감할 날이 없다", () => {
    expect(validateLeaveRange({ start: "2026-08-16", end: "2026-08-16", kind: "annual" })).toContain(
      "차감할 날이 없습니다",
    );
  });
});

describe("표기·종류 판별", () => {
  it("일수 표기는 소수점을 필요할 때만", () => {
    expect(formatLeaveDays(3)).toBe("3일");
    expect(formatLeaveDays(0.5)).toBe("0.5일");
    expect(formatLeaveDays(2.5)).toBe("2.5일");
  });

  it("종류 판별", () => {
    expect(isLeaveKind("annual")).toBe(true);
    expect(isLeaveKind("half")).toBe(true);
    expect(isLeaveKind("sick")).toBe(false);
  });
});
