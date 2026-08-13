// 티어(수업 단가) 기반 강사 정산 — 순수 함수(Vitest). 0199a 급여 배선의 계산 심장부.
//
// 산식(원장 확정 2026-08-10, 강사 출석부 시트 3인 실측으로 검증 — 3인 전원 시트 대비 10원 미만):
//   행 = (학생 × 반 × 티어) 단위,  행 급여 = floor1(단가 × 시수합 × 0.911 × 비율%)
//   정산액 = floor(Σ 행 급여)
// · 0.911 = 1 − 학원 수수료 8.9% (settlement.ts NET_MULTIPLIER와 동일 상수 — 두 값이 갈리면 안 된다)
// · 비율 = 강사 × 과정(초등/중등/고등/수능/특강) — users.commission_rates(0130a), 없으면 commission_rate.
// · floor1(소수 첫째 자리 내림) = 구 출석부 시트·D:\attendance salary.ts와 동일한 라운딩(학원 손해 방지).
//   ⚠️ Math.round로 바꾸면 시트와 학생당 최대 1원씩 어긋나 합계가 수십 원 틀어진다 — 바꾸지 말 것.
//
// ⚠️ 돈 산식이다 — 시트 대조 실측치(김윤하 3,320,389 · 김은정 3,181,049 · 이수진 4,649,941)가
//    테스트에 박혀 있다. 상수·라운딩을 바꾸려면 "왜 달라지는지" 설명이 먼저다(골든마스터 규율).

import { NET_MULTIPLIER } from "./settlement";
import type { GroupRates, SalaryGroup } from "./salary-group";

/** 소수 첫째 자리까지 내림 — 시트 급여칸과 같은 라운딩. */
export function floor1(n: number): number {
  return Math.floor(n * 10) / 10;
}

/**
 * 티어 라벨 → 급여 과정. 시트 '수업' 열의 표기를 그대로 받는다.
 * 순서는 구체적인 것부터(특강 > 수능 > 초·중·고) — salary-group.ts autoSalaryGroup과 같은 결.
 * "수학I (대수)"·"미적분"·"확률과 통계" 같은 고교 과목명 티어는 고등 과정(이수진 시트 실측:
 * 그 티어들의 비율이 전부 고등 비율 47.5%와 일치).
 */
export function tierSalaryGroup(label: string | null | undefined): SalaryGroup | null {
  const n = (label ?? "").trim();
  if (!n) return null;
  if (n.includes("특강")) return "특강";
  if (n.includes("수능")) return "수능";
  if (n.includes("초등")) return "초등";
  if (n.includes("중등")) return "중등";
  if (n.includes("고등")) return "고등";
  if (/수학|미적분|확률/.test(n)) return "고등";
  return null;
}

/** 정산 입력 1행 = (학생 × 반 × 티어)의 그 달 시수 합. */
export type TierRow = {
  studentId: string;
  studentName: string;
  classId: string;
  /** 티어 라벨(기록 예외 ?? 수강 티어). null = 미지정 → 그 학생은 산정 제외 + 명단 표시. */
  tierLabel: string | null;
  /** 출석 시수 합(결석·excused 제외). */
  units: number;
};

/**
 * 산정된 1행의 내역 — **급여명세서의 '수업 내역'**과 매출액 산출에 쓴다.
 * 집계값(total)은 이 배열과 무관하게 기존 로직 그대로 나온다(여기 추가는 순수 부가정보).
 */
export type TierSettlementLine = {
  studentId: string;
  studentName: string;
  classId: string;
  tierLabel: string;
  units: number;
  /** 티어 단가(원). */
  unitPrice: number;
  /** 이 행에 적용된 과정(초등/중등/…) — 비율을 어디서 가져왔는지 밝힌다. */
  group: SalaryGroup | null;
  /** 적용 비율(%). */
  rate: number;
  /** 매출액 기여분 = 단가 × 시수 (수수료·비율 적용 전). */
  gross: number;
  /** 이 행의 급여 = floor1(단가 × 시수 × 0.911 × 비율%). */
  amount: number;
};

export type TierSettlementResult = {
  /** 산정된 정산액(원, 정수 내림). 산정 가능한 행이 하나도 없으면 null. */
  total: number | null;
  /**
   * 매출액 = Σ(단가 × 시수), **수수료(0.911)·비율 적용 전**. 원장 시트 '프리랜서 소득세신고' 탭의
   * `매출액(급여 정산합)` 열과 같은 값이다(김은정 26.07 = 7,307,250 → 급여/매출 = 0.4353).
   * ⚠️ 산정된 행만 더한다 — 단가·비율이 없어 제외된 행은 여기에도 안 들어간다(제외는 excludedUnits로 본다).
   */
  grossTuition: number;
  /** 산정된 행별 내역(명세서 '수업 내역'용). 제외된 행은 담기지 않는다. */
  lines: TierSettlementLine[];
  /** 산정에 들어간 행 수 · 시수 합. */
  rowCount: number;
  unitsTotal: number;
  /** 단가 미지정(티어 없음) 학생 이름 — 시수가 있는데 산정에서 빠진 사람들(0 지어내기 금지). */
  missingTierStudents: string[];
  /** 같은 학생들의 id — 화면이 **행 단위로**(이름 칸 배경) 누가 빠졌는지 가리키기 위한 값(동명이인 안전). */
  missingTierStudentIds: string[];
  /** 단가표에 없는 티어 라벨(오타·미등록). */
  missingPriceTiers: string[];
  /** 비율을 못 정한 과정(그룹 비율·기본 비율 둘 다 없음). */
  missingRateGroups: string[];
  /** 제외된 시수 합(미지정·단가없음·비율없음) — "얼마나 빠졌는지"를 화면이 말할 수 있게. */
  excludedUnits: number;
};

/**
 * 티어 정산 — 행별 floor1 후 합계 정수 내림.
 * 단가·비율이 없는 행은 **조용히 0으로 치지 않고** 제외 명단에 올린다(부분합 + 명단 = 정직한 표시).
 */
export function computeTierSettlement(
  rows: readonly TierRow[],
  unitPriceByTier: ReadonlyMap<string, number>,
  rates: { groupRates: GroupRates | null; defaultRate: number | null },
): TierSettlementResult {
  let raw = 0;
  let rowCount = 0;
  let unitsTotal = 0;
  let excludedUnits = 0;
  let grossTuition = 0;
  const lines: TierSettlementLine[] = [];
  const missingTierStudents = new Set<string>();
  const missingTierStudentIds = new Set<string>();
  const missingPriceTiers = new Set<string>();
  const missingRateGroups = new Set<string>();

  for (const row of rows) {
    if (row.units <= 0) continue;
    if (!row.tierLabel) {
      missingTierStudents.add(row.studentName);
      missingTierStudentIds.add(row.studentId);
      excludedUnits += row.units;
      continue;
    }
    const price = unitPriceByTier.get(row.tierLabel);
    if (price === undefined || price <= 0) {
      missingPriceTiers.add(row.tierLabel);
      excludedUnits += row.units;
      continue;
    }
    const group = tierSalaryGroup(row.tierLabel);
    const rate = group != null && rates.groupRates?.[group] != null
      ? rates.groupRates[group]!
      : rates.defaultRate;
    if (rate === null || rate === undefined) {
      missingRateGroups.add(group ?? row.tierLabel);
      excludedUnits += row.units;
      continue;
    }
    const amount = floor1(price * row.units * NET_MULTIPLIER * (rate / 100));
    raw += amount;
    rowCount++;
    unitsTotal += row.units;
    grossTuition += price * row.units;
    lines.push({
      studentId: row.studentId,
      studentName: row.studentName,
      classId: row.classId,
      tierLabel: row.tierLabel,
      units: row.units,
      unitPrice: price,
      group,
      rate,
      gross: price * row.units,
      amount,
    });
  }

  return {
    total: rowCount > 0 ? Math.floor(raw) : null,
    grossTuition,
    lines,
    rowCount,
    unitsTotal,
    missingTierStudents: [...missingTierStudents].sort((a, b) => a.localeCompare(b, "ko")),
    missingTierStudentIds: [...missingTierStudentIds],
    missingPriceTiers: [...missingPriceTiers].sort((a, b) => a.localeCompare(b, "ko")),
    missingRateGroups: [...missingRateGroups],
    excludedUnits,
  };
}
