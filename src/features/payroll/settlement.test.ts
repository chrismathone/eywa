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
  it("비율제 — 청구 총액 × 0.911(수수료) × 배분율%(정수 반올림)", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000 }), row({ classId: "cls-2", confirmedAmount: 50000 })],
      new Map([["t-park", comp({ commissionRate: 50 })]]),
    );
    expect(s).toMatchObject({
      teacherName: "박민엽",
      classCount: 2,
      confirmedTotal: 150000,
      commissionAmount: 68325, // 150,000 × 0.911 × 50%
      settlement: 68325,
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
    expect(s!.commissionAmount).toBe(273300); // 1,000,000 × 0.911 × 30%
    expect(s!.settlement).toBe(1773300);
  });

  it("배분율 반올림 — 홀수 배분 금액", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 137500 })],
      new Map([["t-park", comp({ commissionRate: 45 })]]),
    );
    expect(s!.commissionAmount).toBe(56368); // 137,500 × 0.911 × 45% = 56,368.125 → 반올림
    expect(s!.settlement).toBe(56368);
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
    expect(s!.settlement).toBe(36440); // 100,000 × 0.911 × 40%
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
    expect(out.map((s) => s.settlement).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([45550, 91100]);
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
    expect(s!.commissionAmount).toBe(45550); // 100,000 × 0.911 × 50%
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
    expect(t.settledTotal).toBe(45550);
    expect(t.pendingCount).toBe(2); // t-2 unset + 미배정
    expect(t.confirmedTotal).toBe(330000);
  });
});

// 2026-07-21 원장: 과정별(초·중·고·수능·특강) 배분율 + 반별 수동 비율.
describe("computeTeacherSettlements — 반마다 다른 배분율", () => {
  const rates = { 초등: 45, 중등: 45, 고등: 45, 수능: 48, 특강: 50 } as const;
  const compG = (over: Partial<TeacherComp> = {}): Map<string, TeacherComp> =>
    new Map([
      [
        "t-park",
        { salaryType: "commission" as const, commissionRate: null, monthlyBase: 0, groupRates: rates, ...over },
      ],
    ]);

  it("반 이름으로 과정을 잡아 반마다 다른 비율을 곱한다(합계에 단일 rate 곱하기 아님)", () => {
    const [s] = computeTeacherSettlements(
      [
        row({ confirmedAmount: 100000, className: "초등M 초5 BS2C" }), // 45%
        row({ classId: "c2", confirmedAmount: 100000, className: "겨울 특강" }), // 50%
      ],
      compG(),
    );
    // 100,000×0.911×45% = 40,995 · 100,000×0.911×50% = 45,550 → 86,545
    expect(s!.commissionAmount).toBe(86545);
    expect(s!.status).toBe("computed");
  });

  it("반별 수동 비율이 과정별을 이긴다", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000, className: "초등M 초5", classRate: 60 })],
      compG(),
    );
    expect(s!.commissionAmount).toBe(54660); // 100,000×0.911×60%
  });

  it("과정을 못 잡고 기본 비율도 없으면 보류 — 어느 반 때문인지 남긴다", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000, className: "JP1" })],
      compG({ commissionRate: null }),
    );
    expect(s!.status).toBe("missing_rate");
    expect(s!.settlement).toBeNull();
    expect(s!.unresolvedClasses).toEqual(["JP1"]);
  });

  it("한 반만 미정이어도 전체 보류 — 일부 계산값을 급여처럼 보여주지 않는다", () => {
    const [s] = computeTeacherSettlements(
      [
        row({ confirmedAmount: 100000, className: "초등M 초5" }),
        row({ classId: "c2", confirmedAmount: 100000, className: "KW6" }),
      ],
      compG({ commissionRate: null }),
    );
    expect(s!.status).toBe("missing_rate");
    expect(s!.unresolvedClasses).toEqual(["KW6"]);
  });

  it("과정이 미분류여도 기본 비율이 있으면 그걸로 계산", () => {
    const [s] = computeTeacherSettlements(
      [row({ confirmedAmount: 100000, className: "KW6" })],
      compG({ commissionRate: 40 }),
    );
    expect(s!.commissionAmount).toBe(36440); // 100,000×0.911×40%
    expect(s!.unresolvedClasses).toEqual([]);
  });
});
