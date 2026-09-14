import { describe, expect, it } from "vitest";
import { computeSplitRows, splitsFingerprint, totalSplits, type SplitRowInput } from "./splits";

const row = (over: Partial<SplitRowInput>): SplitRowInput => ({
  invoiceId: "inv-1",
  classId: "cls-1",
  subject: "math",
  teacherId: "t-park",
  teacherName: "박민엽",
  confirmedSessions: 4,
  unitPrice: 25000,
  amount: 100000,
  actualConsumed: 4,
  ...over,
});

describe("computeSplitRows", () => {
  it("확정 + 단가 행만 분배 행이 된다(N1) — 일치 케이스 diff 0", () => {
    const [s] = computeSplitRows([row({})]);
    expect(s).toMatchObject({
      confirmedSessions: 4,
      unitPrice: 25000,
      confirmedAmount: 100000,
      actualUnits: 4,
      actualAmount: 100000,
      diffAmount: 0,
    });
  });

  it("미확정·단가 없음·반 미상 행은 스킵(지어내지 않음)", () => {
    expect(computeSplitRows([row({ confirmedSessions: null })])).toHaveLength(0);
    expect(computeSplitRows([row({ unitPrice: null, amount: null })])).toHaveLength(0);
    expect(computeSplitRows([row({ classId: null })])).toHaveLength(0);
  });

  it("확정 금액 = 저장 amount 우선, 없으면 확정×단가 폴백", () => {
    expect(computeSplitRows([row({ amount: 99000 })])[0]!.confirmedAmount).toBe(99000);
    expect(computeSplitRows([row({ amount: null })])[0]!.confirmedAmount).toBe(100000);
  });

  it("실측 금액 = round(실 회차 × 단가) — 옛 스냅샷의 소수 값·부동소수 방어", () => {
    const [s] = computeSplitRows([row({ actualConsumed: 1.5, confirmedSessions: 2, amount: 50000 })]);
    expect(s!.actualUnits).toBe(1.5);
    expect(s!.actualAmount).toBe(37500);
    expect(s!.diffAmount).toBe(-12500);
    // 0.1+0.2 류 잔차가 actualUnits에 남지 않는다
    const [t] = computeSplitRows([row({ actualConsumed: 0.1 + 0.2 })]);
    expect(t!.actualUnits).toBe(0.3);
  });

  it("미배정 강사(teacherId null)도 행 생성 — 분배 귀속만 미배정으로 표시", () => {
    const [s] = computeSplitRows([row({ teacherId: null, teacherName: null })]);
    expect(s!.teacherId).toBeNull();
    expect(s!.teacherName).toBeNull();
  });

  it("같은 강사 두 반은 두 행 유지(반 단위 — attendance hasAny 병합 사고 방어)", () => {
    const out = computeSplitRows([
      row({ classId: "cls-1" }),
      row({ classId: "cls-2", confirmedSessions: 2, amount: 50000, actualConsumed: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((s) => s.classId)).size).toBe(2);
  });

  it("정렬 결정적(invoiceId → classId)", () => {
    const out = computeSplitRows([
      row({ invoiceId: "inv-2", classId: "cls-b" }),
      row({ invoiceId: "inv-1", classId: "cls-z" }),
      row({ invoiceId: "inv-2", classId: "cls-a" }),
    ]);
    expect(out.map((s) => `${s.invoiceId}/${s.classId}`)).toEqual([
      "inv-1/cls-z",
      "inv-2/cls-a",
      "inv-2/cls-b",
    ]);
  });
});

describe("totalSplits", () => {
  it("청구/실측 합과 차액 — 두 기준을 합산하지 않는다(R3)", () => {
    const totals = totalSplits([
      { confirmedAmount: 100000, actualAmount: 100000 },
      { confirmedAmount: 50000, actualAmount: 37500 },
    ]);
    expect(totals).toEqual({ rowCount: 2, confirmedAmount: 150000, actualAmount: 137500, diffAmount: -12500 });
  });
});

describe("splitsFingerprint", () => {
  it("강사 재배정은 합계가 같아도 지문이 달라진다(드리프트 맹점 방어)", () => {
    const base = computeSplitRows([row({})]);
    const reassigned = computeSplitRows([row({ teacherId: "t-kim" })]);
    expect(totalSplits(base)).toEqual(totalSplits(reassigned));
    expect(splitsFingerprint(base)).not.toBe(splitsFingerprint(reassigned));
  });

  it("행 순서와 무관하게 결정적(정렬 후 연결)", () => {
    const a = computeSplitRows([row({ invoiceId: "inv-1" }), row({ invoiceId: "inv-2" })]);
    const b = computeSplitRows([row({ invoiceId: "inv-2" }), row({ invoiceId: "inv-1" })]);
    expect(splitsFingerprint(a)).toBe(splitsFingerprint([...b].reverse()));
  });
});
