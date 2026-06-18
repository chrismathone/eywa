import { describe, it, expect } from "vitest";
import {
  scheduleHours,
  aggregateClassHours,
  sumSessionHours,
  computePayrollAmounts,
  payrollTotal,
  summarizePayrollRows,
} from "./calc";

describe("scheduleHours", () => {
  it("정시 구간", () => expect(scheduleHours("14:00", "16:00")).toBe(2));
  it("30분 포함", () => expect(scheduleHours("09:30", "11:00")).toBeCloseTo(1.5, 5));
});

describe("aggregateClassHours", () => {
  it("단일 schedule = 그 시간", () => {
    const m = aggregateClassHours([{ class_id: "c1", start_time: "14:00", end_time: "16:00" }]);
    expect(m.get("c1")).toBe(2);
  });
  it("다중 요일 → 평균", () => {
    const m = aggregateClassHours([
      { class_id: "c1", start_time: "14:00", end_time: "16:00" }, // 2h
      { class_id: "c1", start_time: "14:00", end_time: "15:00" }, // 1h
    ]);
    expect(m.get("c1")).toBeCloseTo(1.5, 5); // (2+1)/2
  });
});

describe("sumSessionHours", () => {
  const hours = new Map([["c1", 2], ["c2", 1.5]]);
  it("고유 (반,날짜) 세션만 합산 — 같은 세션 학생 중복 제거", () => {
    const sessions = [
      { classId: "c1", date: "2026-06-01" },
      { classId: "c1", date: "2026-06-01" }, // 같은 세션 중복(학생 2명) → 1회만
      { classId: "c2", date: "2026-06-02" },
    ];
    expect(sumSessionHours(sessions, hours)).toBeCloseTo(3.5, 5); // 2 + 1.5
  });
  it("schedule 미상 반은 1시간 보수 가정", () => {
    expect(sumSessionHours([{ classId: "unknown", date: "d" }], hours)).toBe(1);
  });
  it("빈 세션 → 0", () => expect(sumSessionHours([], hours)).toBe(0));
});

describe("computePayrollAmounts", () => {
  it("월기본 + 시급분(반올림)", () => {
    const a = computePayrollAmounts({ monthlyBase: 1_000_000, hourlyRate: 30_000, totalHours: 10.5 });
    expect(a.baseAmount).toBe(1_000_000);
    expect(a.hoursWorked).toBe(10.5);
    expect(a.hourlyAmount).toBe(315_000); // 10.5 * 30000
  });
  it("시간 2자리 반올림", () => {
    const a = computePayrollAmounts({ monthlyBase: 0, hourlyRate: 10_000, totalHours: 1.23456 });
    expect(a.hoursWorked).toBe(1.23);
  });
});

describe("payrollTotal", () => {
  it("기본 + 시급분", () => expect(payrollTotal({ baseAmount: 100, hourlyAmount: 50 })).toBe(150));
  it("보너스·공제 반영", () =>
    expect(payrollTotal({ baseAmount: 100, hourlyAmount: 50, bonus: 30, deduction: 20 })).toBe(160));
});

describe("summarizePayrollRows", () => {
  it("빈 입력은 0", () =>
    expect(summarizePayrollRows([])).toEqual({
      totalBase: 0,
      totalNet: 0,
      paidCount: 0,
      savedCount: 0,
      draftCount: 0,
    }));
  it("상태별 카운트 + 합계", () => {
    const s = summarizePayrollRows([
      { baseAmount: 100, total: 130, status: "paid" },
      { baseAmount: 200, total: 220, status: "saved" },
      { baseAmount: 150, total: 150, status: "draft" },
      { baseAmount: 50, total: 60, status: "paid" },
    ]);
    expect(s.totalBase).toBe(500);
    expect(s.totalNet).toBe(560);
    expect(s.paidCount).toBe(2);
    expect(s.savedCount).toBe(1);
    expect(s.draftCount).toBe(1);
  });
});
