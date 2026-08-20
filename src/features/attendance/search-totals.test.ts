// 검색 기준 집계 — **모수만 바꾸고 산식은 그대로**임을 잠그는 테스트.
//
// 🔴 이 파일의 핵심은 "검색을 안 걸었을 때(ids=null) 지금 화면 숫자와 1원도 안 갈린다"는 항등식이다.
//    정산액은 급여 재료라, 분해를 붙이면서 반올림 자리가 옮겨 가면 그게 곧 돈 사고다.
import { describe, expect, it } from "vitest";
import {
  classCountOfRows,
  scopedExclusions,
  scopedMoneyTotals,
  scopedSettlement,
} from "./search-totals";
import { computeTierSettlement, type TierRow } from "@/features/payroll/tier-settlement";
import { rowKey } from "./grid/model";

const S1 = "s1";
const S2 = "s2";
const S3 = "s3";
const C1 = "c1";
const C2 = "c2";

describe("scopedMoneyTotals — 청구·납입은 고유 학생 1회", () => {
  const byStudent = {
    [S1]: { billed: 300_000, paid: 300_000, shared: false },
    [S2]: { billed: 250_000, paid: 100_000, shared: true },
    [S3]: { billed: 400_000, paid: 0, shared: true },
  };

  it("ids=null이면 전체 — 서버가 내는 totals와 같은 값", () => {
    expect(scopedMoneyTotals(byStudent, null)).toEqual({
      billed: 950_000,
      paid: 400_000,
      students: 3,
      sharedStudents: 2,
    });
  });

  it("검색 기준이면 걸린 학생만 — 인원·공유 인원도 함께 좁는다", () => {
    expect(scopedMoneyTotals(byStudent, new Set([S2]))).toEqual({
      billed: 250_000,
      paid: 100_000,
      students: 1,
      sharedStudents: 1,
    });
  });

  it("🔴 같은 학생이 여러 반에 나와도 청구는 한 번만 — 모수는 줄이 아니라 사람이다", () => {
    // 줄 기준이면 S1이 두 번 더해져 600,000이 된다. 키가 학생이라 구조적으로 불가능하다.
    const ids = new Set([S1, S1]);
    expect(scopedMoneyTotals(byStudent, ids).billed).toBe(300_000);
    expect(scopedMoneyTotals(byStudent, ids).students).toBe(1);
  });

  it("아무도 안 걸리면 0 — '자료 없음'이 아니라 0명 기준이라는 사실", () => {
    expect(scopedMoneyTotals(byStudent, new Set())).toEqual({
      billed: 0,
      paid: 0,
      students: 0,
      sharedStudents: 0,
    });
  });
});

// ─────────────── 정산액 — 돈. 산식 불변 항등식 ───────────────

const row = (studentId: string, name: string, classId: string, tier: string | null, units: number): TierRow => ({
  studentId,
  studentName: name,
  classId,
  tierLabel: tier,
  units,
});

/** 시트 실측 단가(tier-settlement.test.ts와 같은 표). */
const PRICES = new Map([
  ["중등 3T", 25_000],
  ["초등 2T", 21_250],
  ["고등 1T", 30_000],
]);
const RATES = { groupRates: { 초등: 47.5, 중등: 47.5, 고등: 47.5 }, defaultRate: 45 };

const ROWS: TierRow[] = [
  row(S1, "윤현소", C1, "중등 3T", 12),
  row(S1, "윤현소", C2, "초등 2T", 5),
  row(S2, "박서준", C1, "고등 1T", 7),
  row(S3, "최유나", C1, "중등 3T", 3.5),
];

function linesOf(rows: TierRow[]) {
  const r = computeTierSettlement(rows, PRICES, RATES);
  return { result: r, lines: r.lines.map((l) => ({ studentId: l.studentId, units: l.units, amount: l.amount })) };
}

describe("scopedSettlement — 🔴 산식을 다시 쓰지 않는다", () => {
  it("🔴 ids=null이면 computeTierSettlement의 total과 **완전히 같다**(반올림 자리 불변)", () => {
    const { result, lines } = linesOf(ROWS);
    expect(scopedSettlement(lines, null).total).toBe(result.total);
    expect(scopedSettlement(lines, null).unitsTotal).toBe(result.unitsTotal);
    expect(scopedSettlement(lines, null).rowCount).toBe(result.rowCount);
  });

  it("🔴 학생별 부분합을 다 더해도 전체와 어긋나지 않는다(모수만 갈랐을 뿐)", () => {
    const { result, lines } = linesOf(ROWS);
    const parts = [S1, S2, S3].map((id) => scopedSettlement(lines, new Set([id])));
    // 행 금액은 이미 floor1로 확정 → 부분합의 합과 전체 합이 갈릴 여지가 없다(마지막 정수 내림만 다름).
    const rawSum = parts.reduce((a, p) => a + (p.total ?? 0), 0);
    expect(Math.abs(rawSum - result.total!)).toBeLessThanOrEqual(parts.length);
    expect(parts.reduce((a, p) => a + p.unitsTotal, 0)).toBe(result.unitsTotal);
  });

  it("검색 기준 정산액 = 그 학생 행만 — 여러 반·여러 티어면 전부 더한다", () => {
    const { lines } = linesOf(ROWS);
    const s1 = scopedSettlement(lines, new Set([S1]));
    // 25,000×12×0.911×47.5% + 21,250×5×0.911×47.5%
    const a = Math.floor(25_000 * 12 * 0.911 * 0.475 * 10) / 10;
    const b = Math.floor(21_250 * 5 * 0.911 * 0.475 * 10) / 10;
    expect(s1.total).toBe(Math.floor(a + b));
    expect(s1.unitsTotal).toBe(17);
    expect(s1.rowCount).toBe(2);
  });

  it("🔴 해당 행이 없으면 null — 0원을 지어내지 않는다", () => {
    const { lines } = linesOf(ROWS);
    expect(scopedSettlement(lines, new Set(["없는학생"])).total).toBeNull();
  });
});

describe("scopedExclusions — 경고 숫자도 같은 모수로", () => {
  const MIXED: TierRow[] = [
    ...ROWS,
    row("s4", "김하늘", C1, null, 4), // 티어 미지정
    row("s5", "이서연", C2, "없는티어", 2.5), // 단가표 미등록
  ];

  it("🔴 ids=null이면 원본 집계값과 같다 — 명단·정렬·제외 시수까지", () => {
    const r = computeTierSettlement(MIXED, PRICES, RATES);
    const scoped = scopedExclusions(r.excludedLines, null);
    expect(scoped.missingTierStudents).toEqual(r.missingTierStudents);
    expect(scoped.missingPriceTiers).toEqual(r.missingPriceTiers);
    expect(scoped.excludedUnits).toBe(r.excludedUnits);
  });

  it("검색으로 좁히면 그 학생 몫만 남는다 — '1명 검색에 단가 미지정 3명'을 막는다", () => {
    const r = computeTierSettlement(MIXED, PRICES, RATES);
    expect(scopedExclusions(r.excludedLines, new Set([S1]))).toEqual({
      missingTierStudents: [],
      missingPriceTiers: [],
      excludedUnits: 0,
    });
    expect(scopedExclusions(r.excludedLines, new Set(["s4"]))).toEqual({
      missingTierStudents: ["김하늘"],
      missingPriceTiers: [],
      excludedUnits: 4,
    });
  });

  it("제외 행은 산정 금액을 건드리지 않는다 — 부가정보일 뿐", () => {
    expect(computeTierSettlement(MIXED, PRICES, RATES).total).toBe(
      computeTierSettlement(ROWS, PRICES, RATES).total,
    );
  });
});

describe("classCountOfRows — '반 N개'는 줄 수가 아니다", () => {
  it("같은 반에서 둘이 걸리면 1개 반", () => {
    expect(classCountOfRows([rowKey(C1, S1), rowKey(C1, S2)])).toBe(1);
  });

  it("반이 다르면 각각 센다", () => {
    expect(classCountOfRows([rowKey(C1, S1), rowKey(C2, S1)])).toBe(2);
  });

  it("빈 목록은 0", () => {
    expect(classCountOfRows([])).toBe(0);
  });
});
