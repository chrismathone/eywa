/**
 * 월별 출석부 **검색 기준 집계** — 무엇을 어떤 모수로 세는가를 정하는 순수 함수(Vitest).
 *
 * 원장 제보(2026-08-20): *"학생 검색시 하단 숫자는 안바뀌네."* — 검색으로 반 2개·행 2줄만 남았는데
 * 하단은 `10개 반 · 시수 279.5 · 청구 17,099,375 …` 전체 값 그대로였다. 목록만 좁고 숫자는 전체인
 * 화면은 "좁혀 놓고 전체인 척하는 숫자"라 이 저장소가 가장 경계하는 실패다([[#89]]).
 *
 * 🔴 **여기서 돈 산식을 다시 쓰지 않는다.** 정산액은 서버가 이미 행마다 `floor1(단가×시수×0.911×비율)`로
 *    확정한 금액을 **골라 더하기만** 한다(`scopedSettlement`). 모수(ids)가 null이면 연산 순서까지 원본과
 *    같아 `computeTierSettlement().total`과 **1원도 안 갈린다** — 그 성질을 테스트가 잠근다.
 * 🔴 **청구는 고유 학생 1회.** 강사 전체 보기는 한 학생이 여러 반에 나와 줄이 둘 이상인데, 청구서는
 *    학생×월 한 장이라 줄마다 더하면 검색 기준에서도 곧바로 2배가 된다.
 * ⚠️ 모수는 **학생 id 집합**이다(이름 아님) — 동명이인이 한 명으로 접히면 남의 돈이 섞인다.
 */
import { classIdOfRow } from "./grid/model";

/** 학생 하나의 그 달 청구·납입(`TeacherMoney.byStudent`의 값과 같은 모양). */
export type StudentMoneyLike = { billed: number; paid: number; shared: boolean };

export type ScopedMoneyTotals = {
  billed: number;
  paid: number;
  /** 금액이 잡힌 **고유 학생 수** — 화면의 "N명 기준". */
  students: number;
  /** 그중 청구서를 다른 강사와 나눠 쓰는 학생 수. */
  sharedStudents: number;
};

/**
 * 청구·납입 합 — `byStudent`의 **키가 곧 학생**이라 중복 가산이 구조적으로 불가능하다.
 * `ids`가 null이면 전체(= 서버 `totals`와 같은 순회·같은 값).
 */
export function scopedMoneyTotals(
  byStudent: Readonly<Record<string, StudentMoneyLike>>,
  ids: ReadonlySet<string> | null,
): ScopedMoneyTotals {
  let billed = 0;
  let paid = 0;
  let students = 0;
  let sharedStudents = 0;
  for (const [id, m] of Object.entries(byStudent)) {
    if (ids && !ids.has(id)) continue;
    billed += m.billed;
    paid += m.paid;
    students++;
    if (m.shared) sharedStudents++;
  }
  return { billed, paid, students, sharedStudents };
}

/** 정산에 들어간 1행(`TierSettlementLine`의 부분집합) — 금액은 서버가 확정한 값 그대로. */
export type SettlementLineLike = { studentId: string; units: number; amount: number };

export type ScopedSettlement = {
  /** 산정된 정산액(원, 정수 내림). 해당하는 행이 하나도 없으면 null(0을 지어내지 않는다). */
  total: number | null;
  unitsTotal: number;
  rowCount: number;
};

/**
 * 정산액 — 행 순서 그대로 더한 뒤 **정수 내림**. 산식은 손대지 않는다(행 금액은 이미 확정값).
 *
 * 🔴 `ids === null`이면 `computeTierSettlement`의 누산과 **연산이 동일**하다(같은 배열·같은 순서·같은
 *    `Math.floor`). 학생별로 미리 접었다가 다시 더하면 부동소수 결합순서가 달라져 1원이 흔들릴 수 있어
 *    그렇게 하지 않는다.
 */
export function scopedSettlement(
  lines: readonly SettlementLineLike[],
  ids: ReadonlySet<string> | null,
): ScopedSettlement {
  let raw = 0;
  let unitsTotal = 0;
  let rowCount = 0;
  for (const l of lines) {
    if (ids && !ids.has(l.studentId)) continue;
    raw += l.amount;
    unitsTotal += l.units;
    rowCount++;
  }
  return { total: rowCount > 0 ? Math.floor(raw) : null, unitsTotal, rowCount };
}

/** 산정에서 빠진 1행(`TierSettlementExcluded`와 같은 모양). */
export type ExcludedLineLike = {
  studentId: string;
  studentName: string;
  units: number;
  reason: "no-tier" | "no-price" | "no-rate";
  tierLabel: string | null;
};

export type ScopedExclusions = {
  missingTierStudents: string[];
  missingPriceTiers: string[];
  excludedUnits: number;
};

/**
 * "단가 미지정 N명 · N시수 제외" 경고를 **같은 모수로** 다시 접는다.
 * 🔴 이걸 안 좁히면 1명을 검색해 놓고 "단가 미지정 3명"이 뜬다 — 화면 안에서 어떤 숫자는 검색 기준,
 *    어떤 숫자는 전체인 상태가 제일 나쁘다.
 * `ids`가 null이면 원본 집계값(정렬·중복 제거까지)과 같은 결과가 나온다.
 */
export function scopedExclusions(
  lines: readonly ExcludedLineLike[],
  ids: ReadonlySet<string> | null,
): ScopedExclusions {
  const names = new Set<string>();
  const tiers = new Set<string>();
  let excludedUnits = 0;
  for (const l of lines) {
    if (ids && !ids.has(l.studentId)) continue;
    excludedUnits += l.units;
    if (l.reason === "no-tier") names.add(l.studentName);
    else if (l.reason === "no-price" && l.tierLabel) tiers.add(l.tierLabel);
  }
  return {
    missingTierStudents: [...names].sort((a, b) => a.localeCompare(b, "ko")),
    missingPriceTiers: [...tiers].sort((a, b) => a.localeCompare(b, "ko")),
    excludedUnits,
  };
}

/**
 * 검색에 걸린 행들이 걸쳐 있는 **반 수** — 행 키(`classId|studentId`)에서 반만 추려 센다.
 * ⚠️ 줄 수가 아니라 반 수다(한 반에서 둘이 걸리면 1개 반).
 */
export function classCountOfRows(rows: Iterable<string>): number {
  const seen = new Set<string>();
  for (const r of rows) seen.add(classIdOfRow(r));
  return seen.size;
}
