import { describe, expect, it } from "vitest";
import {
  computeTeacherSettlements,
  totalSettlements,
  type SettlementRowInput,
  type TeacherComp,
} from "./settlement";

const row = (over: Partial<SettlementRowInput>): SettlementRowInput => ({
  teacherId: "t-park",
  teacherName: "박민엽",
  classId: "cls-1",
  confirmedAmount: 100000,
  actualAmount: 100000,
  ...over,
});

const comp = (over: Partial<TeacherComp>): TeacherComp => ({
  salaryType: "commission",
  commissionRate: 50,
  monthlyBase: 0,
  ...over,
});

describe("computeTeacherSettlements", () => {
  it("비율제 — 청구 총액 × 배분율%(정수 반올림)", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000 }), row({ classId: "cls-2", confirmedAmount: 50000 })],
      new Map([["t-park", comp({ commissionRate: 50 })]]),
    );
    expect(s).toMatchObject({
      teacherName: "박민엽",
      classCount: 2,
      confirmedTotal: 150000,
      commissionAmount: 75000,
      settlement: 75000,
      status: "computed",
    });
  });

  it("급여제 — 월 고정급(splits 무관)", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 999999 })],
      new Map([["t-park", comp({ salaryType: "fixed", monthlyBase: 3000000, commissionRate: null })]]),
    );
    expect(s!.settlement).toBe(3000000);
    expect(s!.commissionAmount).toBe(0);
    expect(s!.status).toBe("computed");
  });

  it("혼합 — 기본급 + 배분액", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 1000000 })],
      new Map([["t-park", comp({ salaryType: "hybrid", monthlyBase: 1500000, commissionRate: 30 })]]),
    );
    expect(s!.commissionAmount).toBe(300000);
    expect(s!.settlement).toBe(1800000);
  });

  it("배분율 반올림 — 홀수 배분 금액", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 137500 })],
      new Map([["t-park", comp({ commissionRate: 45 })]]),
    );
    expect(s!.commissionAmount).toBe(61875); // 137500 × 0.45
    expect(s!.settlement).toBe(61875);
  });

  it("급여 방식 미설정 — settlement null, status unset(0으로 지어내지 않음)", () => {
    const [s] = computeTeacherSettlements([row({})], new Map());
    expect(s!.settlement).toBeNull();
    expect(s!.status).toBe("unset");
    expect(s!.confirmedTotal).toBe(100000); // 청구 총액은 표시
  });

  it("비율제인데 배분율 누락 — missing_rate, settlement null", () => {
    const [s] = computeTeacherSettlements(
      [row({})],
      new Map([["t-park", comp({ salaryType: "commission", commissionRate: null })]]),
    );
    expect(s!.settlement).toBeNull();
    expect(s!.status).toBe("missing_rate");
  });

  it("급여제인데 기본급 0 — missing_base, settlement null(0을 '산정 완료'로 오표시 안 함)", () => {
    const [s] = computeTeacherSettlements(
      [row({})],
      new Map([["t-park", comp({ salaryType: "fixed", monthlyBase: 0, commissionRate: null })]]),
    );
    expect(s!.settlement).toBeNull();
    expect(s!.status).toBe("missing_base");
  });

  it("혼합은 기본급 0이어도 배분액으로 산정(급여제와 달리 base 0 정상)", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000 })],
      new Map([["t-park", comp({ salaryType: "hybrid", monthlyBase: 0, commissionRate: 40 })]]),
    );
    expect(s!.settlement).toBe(40000);
    expect(s!.status).toBe("computed");
  });

  it("미배정(teacherId null) — unassigned, 맨 뒤 정렬, settlement null", () => {
    const out = computeTeacherSettlements(
      [
        row({ teacherId: null, teacherName: null, classId: "고아반" }),
        row({ teacherId: "t-park", confirmedAmount: 100000 }),
      ],
      new Map([["t-park", comp({ commissionRate: 50 })]]),
    );
    expect(out.map((s) => s.teacherName)).toEqual(["박민엽", "미배정"]);
    expect(out[1]!.status).toBe("unassigned");
    expect(out[1]!.settlement).toBeNull();
  });

  it("동명이인 강사(같은 이름, 다른 id) 분리 — teacher_id 그룹(P3)", () => {
    const out = computeTeacherSettlements(
      [
        row({ teacherId: "t-1", teacherName: "김태건", confirmedAmount: 100000 }),
        row({ teacherId: "t-2", teacherName: "김태건", confirmedAmount: 200000, classId: "cls-x" }),
      ],
      new Map([
        ["t-1", comp({ commissionRate: 50 })],
        ["t-2", comp({ commissionRate: 50 })],
      ]),
    );
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.settlement).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([50000, 100000]);
  });

  it("actual/diff는 신호로만 — confirmed와 절대 합산 안 함(R3/P2)", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000, actualAmount: 90000 })],
      new Map([["t-park", comp({ commissionRate: 50 })]]),
    );
    expect(s!.confirmedTotal).toBe(100000);
    expect(s!.actualTotal).toBe(90000);
    expect(s!.diffTotal).toBe(-10000);
    // 배분은 confirmed에만 적용 — actual이 섞이지 않는다
    expect(s!.commissionAmount).toBe(50000);
  });
});

describe("totalSettlements", () => {
  it("산정된 급여만 합산, 미설정/미배정은 보류로 카운트", () => {
    const rows = computeTeacherSettlements(
      [
        row({ teacherId: "t-1", confirmedAmount: 100000 }),
        row({ teacherId: "t-2", confirmedAmount: 200000, classId: "c2" }),
        row({ teacherId: null, teacherName: null, confirmedAmount: 30000, classId: "c3" }),
      ],
      new Map([["t-1", comp({ commissionRate: 50 })]]), // t-2 미설정, null 미배정
    );
    const t = totalSettlements(rows);
    expect(t.teacherCount).toBe(1); // t-1만 산정
    expect(t.settledTotal).toBe(50000);
    expect(t.pendingCount).toBe(2); // t-2 unset + 미배정
    expect(t.confirmedTotal).toBe(330000);
  });
});
