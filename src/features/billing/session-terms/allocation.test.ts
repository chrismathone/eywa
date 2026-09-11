import { describe, expect, it } from "vitest";
import { aggregateTeacherAllocations, hasAllocationSignal, type AllocationRowInput } from "./allocation";

const row = (over: Partial<AllocationRowInput>): AllocationRowInput => ({
  className: "BS2C",
  teacherId: "t-kim",
  teacherName: "김강사",
  confirmedSessions: 12,
  unitPrice: 25000,
  amount: 300000,
  actualConsumed: 12,
  ...over,
});

describe("aggregateTeacherAllocations", () => {
  it("실측 0회라도 확정 회차의 금액 근거가 없으면 확정 금액은 미계산이다", () => {
    const [a] = aggregateTeacherAllocations([row({ amount: null, unitPrice: null, actualConsumed: 0 })]);
    expect(a).toMatchObject({ actualAmount: 0, missingPriceRows: 0, missingConfirmedRows: 1, confirmedPricedRows: 0 });
  });

  it("단가가 없어도 저장된 확정 금액 0원은 유효한 금액이다", () => {
    const [a] = aggregateTeacherAllocations([row({ amount: 0, unitPrice: null, actualConsumed: 0 })]);
    expect(a).toMatchObject({ confirmedAmount: 0, missingConfirmedRows: 0, confirmedPricedRows: 1 });
  });
  it("확정 금액 = 저장 amount 우선, 실측 금액 = 실 시수 × 단가 — 일치 시 diff 0", () => {
    const [a] = aggregateTeacherAllocations([row({})]);
    expect(a).toMatchObject({
      teacherName: "김강사",
      classCount: 1,
      rowCount: 1,
      confirmedSessions: 12,
      confirmedAmount: 300000,
      actualUnits: 12,
      actualAmount: 300000,
      diffAmount: 0,
      missingPriceRows: 0,
    });
  });

  it("배수 시수(1.5·2)가 실측 금액에 곱해진다 — 12.5회 × 25,000 = 312,500", () => {
    const [a] = aggregateTeacherAllocations([row({ actualConsumed: 12.5 })]);
    expect(a!.actualUnits).toBe(12.5);
    expect(a!.actualAmount).toBe(312500);
    expect(a!.diffAmount).toBe(12500);
  });

  it("같은 강사 여러 반은 합산, 반 수는 distinct", () => {
    const [a] = aggregateTeacherAllocations([
      row({ className: "BS2C" }),
      row({ className: "JJ3K", confirmedSessions: 8, amount: 200000, actualConsumed: 8 }),
      row({ className: "BS2C", confirmedSessions: 4, amount: 100000, actualConsumed: 4 }),
    ]);
    expect(a!.classCount).toBe(2);
    expect(a!.rowCount).toBe(3);
    expect(a!.confirmedSessions).toBe(24);
    expect(a!.confirmedAmount).toBe(600000);
    expect(a!.actualAmount).toBe(600000);
  });

  it("그룹 키 = teacherId — 동명이인 강사(같은 display_name, 다른 id)는 별도 행으로 분리", () => {
    const out = aggregateTeacherAllocations([
      row({ teacherId: "t-1", teacherName: "김민수" }),
      row({ teacherId: "t-2", teacherName: "김민수", className: "JJ3K", confirmedSessions: 8, amount: 200000, actualConsumed: 8 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.confirmedAmount).sort((a, b) => a - b)).toEqual([200000, 300000]);
  });

  it("amount 없으면 confirmed × unitPrice로 폴백", () => {
    const [a] = aggregateTeacherAllocations([row({ amount: null })]);
    expect(a!.confirmedAmount).toBe(300000);
  });

  it("미확정 행(confirmed null)은 확정 금액 0, 실측만 집계", () => {
    const [a] = aggregateTeacherAllocations([
      row({ confirmedSessions: null, amount: null, actualConsumed: 5 }),
    ]);
    expect(a!.confirmedSessions).toBe(0);
    expect(a!.confirmedAmount).toBe(0);
    expect(a!.actualAmount).toBe(125000);
    expect(a!.diffAmount).toBe(125000);
  });

  it("단가 없는 행은 금액에서 제외 + missingPriceRows로 정직 표시(지어내지 않음)", () => {
    const [a] = aggregateTeacherAllocations([
      row({}),
      row({ unitPrice: null, amount: null, confirmedSessions: null, actualConsumed: 3 }),
    ]);
    expect(a!.actualAmount).toBe(300000);
    expect(a!.missingPriceRows).toBe(1);
  });

  it("강사 없음(teacherId null)은 '미배정'으로 묶여 맨 뒤 정렬", () => {
    const out = aggregateTeacherAllocations([
      row({ teacherId: null, teacherName: null, className: "고아반" }),
      row({ teacherId: "t-park", teacherName: "박강사", confirmedSessions: 1, amount: 10000, actualConsumed: 1 }),
    ]);
    expect(out.map((t) => t.teacherName)).toEqual(["박강사", "미배정"]);
  });

  it("부동소수 방어 — 0.5 시수 3회 합이 1.5로 깨끗하게", () => {
    const [a] = aggregateTeacherAllocations([
      row({ actualConsumed: 0.5, confirmedSessions: null, amount: null }),
      row({ actualConsumed: 0.5, confirmedSessions: null, amount: null }),
      row({ actualConsumed: 0.5, confirmedSessions: null, amount: null }),
    ]);
    expect(a!.actualUnits).toBe(1.5);
    expect(a!.actualAmount).toBe(37500);
  });
});

describe("hasAllocationSignal", () => {
  it("전부 0(미확정·출석 0)이면 노이즈 — 제외 대상", () => {
    const [zero] = aggregateTeacherAllocations([
      row({ confirmedSessions: null, amount: null, actualConsumed: 0 }),
    ]);
    expect(hasAllocationSignal(zero!)).toBe(false);
  });

  it("확정·실측·단가없음 중 하나라도 있으면 표시", () => {
    const [confirmed] = aggregateTeacherAllocations([row({})]);
    expect(hasAllocationSignal(confirmed!)).toBe(true);
    const [actualOnly] = aggregateTeacherAllocations([
      row({ confirmedSessions: null, amount: null, actualConsumed: 1 }),
    ]);
    expect(hasAllocationSignal(actualOnly!)).toBe(true);
    const [missingPrice] = aggregateTeacherAllocations([
      row({ confirmedSessions: null, amount: null, unitPrice: null, actualConsumed: 1 }),
    ]);
    expect(hasAllocationSignal(missingPrice!)).toBe(true);
  });
});
