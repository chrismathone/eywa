// 티어(수업 단가) 기반 강사 정산 — 순수 함수(Vitest). 0199a 급여 배선의 계산 심장부.
//
// 산식(원장 확정 2026-08-10, 강사 출석부 시트 3인 실측으로 검증 — 3인 전원 시트 대비 10원 미만):
//   행 = (학생 × 반 × 티어) 단위,  행 급여 = floor1(단가 × 시수합 × 0.911 × 비율%)
//   정산액 = floor(Σ 행 급여)
// · 0.911 = 1 − 학원 수수료 8.9% (settlement.ts NET_MULTIPLIER와 동일 상수 — 두 값이 갈리면 안 된다)
// · 비율 = 강사 × 과정(초등/중등/고등/수능/특강) — users.commission_rates(0130a), 없으면 commission_rate.
// · 단가 = **회차 확정 단가**(그 달 회차가 전부 확정·시수 기준일 때, 수학 반) → 없으면 수강 티어 단가표
//   (원장 2026-09-18 *"회차 확정에서 전부 결정하지 않았나?"* — 같은 단가를 두 곳에 따로 적던 것을 회차 확정으로 통일).
// · floor1(소수 첫째 자리 내림) = 구 출석부 시트·D:\attendance salary.ts와 동일한 라운딩(학원 손해 방지).
//   ⚠️ Math.round로 바꾸면 시트와 학생당 최대 1원씩 어긋나 합계가 수십 원 틀어진다 — 바꾸지 말 것.
//
// ⚠️ 돈 산식이다 — 시트 대조 실측치(김윤하 3,320,389 · 김은정 3,181,049 · 이수진 4,649,941)가
//    테스트에 박혀 있다. 상수·라운딩을 바꾸려면 "왜 달라지는지" 설명이 먼저다(골든마스터 규율).

import { excludedFromHomeroom, isSubstituteRowOf } from "@/features/attendance/teacher-axis";
import { NET_MULTIPLIER } from "./settlement";
import type { GroupRates, SalaryGroup } from "./salary-group";

/**
 * 회차 확정 단가로 산정한 줄의 표시 라벨 — 수강 티어가 없거나 그 티어의 단가가 회차 단가와 다를 때.
 * (명세서 스냅샷 `lines[].tierLabel`에 남는다. 화면엔 그리지 않는다.)
 */
export const SESSION_PRICE_LABEL = "회차 확정 단가";

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

/**
 * 회차 단가로 **과정**(비율을 고를 축)을 정한다 — 그 단가를 가진 티어들의 과정에서 읽는다.
 *
 * 원장 2026-09-18 *"회차 확정에서 전부 결정하지 않았나?"* → 정산 단가를 회차 확정 단가로 통일(수학).
 * 🔴 **반 이름으로 정하지 말 것** — '개별' 반은 학년이 섞여 있다(실측 2026-09: `고등M 개별 토`에 초등 단가 21,250,
 *    `초등M 개별 BS1D`에 중등 단가 24,000). 단가가 곧 그 학생의 티어라 단가가 과정을 말한다(시트에서 티어를 고르던 것과 같다).
 * 🔑 단가표는 **정규 티어와 특강 티어가 같은 금액을 나눠 쓴다**(21,250 = 초등 3T · 초등특강). 그래서 특강 여부는 **반**이 정하고
 *    (반 과정이 '특강'이면 특강), 나머지는 특강 티어를 뺀 과정이 **하나로 모일 때만** 그 과정이다.
 *    안 모이면(그 금액이 특강 전용 · 과정 없는 라벨뿐) 반 과정으로 폴백 — 그것도 없으면 null(기본 비율, 없으면 '비율 미설정').
 */
export function salaryGroupForPrice(
  price: number,
  classGroup: SalaryGroup | null,
  unitPriceByTier: ReadonlyMap<string, number>,
): SalaryGroup | null {
  if (classGroup === "특강") return "특강";
  const groups = new Set<SalaryGroup>();
  for (const [label, p] of unitPriceByTier) {
    if (p !== price) continue;
    const g = tierSalaryGroup(label);
    if (g && g !== "특강") groups.add(g);
  }
  return groups.size === 1 ? [...groups][0]! : classGroup;
}

/** 회차 행 한 줄(정산 단가 판정에 필요한 칸만). */
export type SessionPriceTerm = {
  confirmed_sessions: number | string | null;
  unit_price: number | string | null;
  pricing_mode: string | null;
  quantity_basis: string | null;
};

/**
 * 한 학생×반의 그 달 **회차 확정 단가** — 정산에 쓸 수 있을 때만 숫자, 아니면 null(수강 티어로 폴백).
 * · 회차 행이 **전부** 확정(`confirmed_sessions`)·단가 있음 — 하나라도 미확정이면 아직 정한 게 아니다.
 * · **회당 × 시수 기준**만(`per_session` + `attendance_units`) — 월 정액은 월 금액이고, 옛 일수 기준은 단위가 다르다
 *   (티어 단가는 시수당이라 곱하는 축이 같아야 한다).
 * · 청구서가 둘이라 단가가 갈리면 모른다(null) — 고르지 않는다.
 */
export function sessionPriceOf(terms: readonly SessionPriceTerm[]): number | null {
  if (terms.length === 0) return null;
  let price: number | null = null;
  for (const t of terms) {
    if (t.confirmed_sessions === null || t.unit_price === null) return null;
    if ((t.pricing_mode ?? "per_session") !== "per_session") return null;
    if (t.quantity_basis !== "attendance_units") return null;
    const p = Number(t.unit_price);
    if (!Number.isFinite(p) || p <= 0) return null;
    if (price !== null && price !== p) return null;
    price = p;
  }
  return price;
}

/** 정산 입력 1행 = (학생 × 반 × 티어)의 그 달 시수 합. */
export type TierRow = {
  studentId: string;
  studentName: string;
  classId: string;
  /** 티어 라벨(기록 예외 ?? 수강 티어). null = 미지정 → 회차 단가도 없으면 산정 제외 + 명단 표시. */
  tierLabel: string | null;
  /** 출석 시수 합(결석·excused 제외). */
  units: number;
  /**
   * **회차 확정 단가**(원, 시수당) — 있으면 이 값이 단가다(원장 2026-09-18: 정산 단가를 회차 확정으로 통일, 수학).
   * 없으면(null·생략) 종전대로 티어 단가. 조립([`collectTierRows`])이 `sessionPriceOf`로 정하고, 기록 예외 티어 줄엔 안 붙인다.
   */
  sessionPrice?: number | null;
  /** 반의 급여 과정(수동 지정 ?? 반 이름) — 회차 단가로 과정을 정할 때 특강 판정·폴백에만 쓴다. */
  classGroup?: SalaryGroup | null;
  /**
   * **대신 보강 귀속 강사**(`attendance_records.taught_by`, 0316a) — 있으면 이 줄의 시수는 반 담임이 아니라 이 강사 몫이다
   * (원장 결정 3, 2026-09-30). null·생략 = 종전(반 담임 몫). 조립이 같은 학생·반이라도 귀속이 다르면 줄을 가른다.
   */
  taughtBy?: string | null;
};

/**
 * 강사 한 명의 정산 줄만 고른다 — 🔴 원장 결정 3(2026-09-30): 대신 보강 칸은 반 담임이 아니라 **보강한 강사** 몫.
 *  · 담임 반의 줄 중 귀속이 비었거나 본인인 줄(다른 강사의 대신 보강은 뺀다 — `excludedFromHomeroom`)
 *  · 남의 반이라도 귀속이 본인인 줄(`isSubstituteRowOf`)
 * 판정은 축 단일 소스(`teacher-axis.ts`). 명세서·출석부 정산액·수납 정산 면이 같은 함수를 쓴다.
 */
export function tierRowsOwnedBy<T extends Pick<TierRow, "classId" | "taughtBy">>(
  rows: readonly T[],
  teacherId: string,
  homeroomClassIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) =>
    homeroomClassIds.has(r.classId) ? !excludedFromHomeroom(r, teacherId) : isSubstituteRowOf(r, teacherId),
  );
}

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
  /** 적용 단가(원) — 회차 확정 단가 또는 티어 단가. */
  unitPrice: number;
  /** 단가 출처 — `session` = 회차 확정 단가(2026-09-18~), `tier` = 수강 티어 단가표. */
  priceSource: "session" | "tier";
  /** 이 행에 적용된 과정(초등/중등/…) — 비율을 어디서 가져왔는지 밝힌다. */
  group: SalaryGroup | null;
  /** 적용 비율(%). */
  rate: number;
  /** 매출액 기여분 = 단가 × 시수 (수수료·비율 적용 전). */
  gross: number;
  /** 이 행의 급여 = floor1(단가 × 시수 × 0.911 × 비율%). */
  amount: number;
};

/**
 * 산정에서 **빠진** 1행 — 왜 빠졌는지와 누구 몫이었는지를 행 단위로 남긴다.
 *
 * 🔑 집계값(missingTierStudents·missingPriceTiers·excludedUnits)은 이 배열을 **다시 접어** 만들 수 있는
 *    같은 사실이다. 화면이 부분집합(학생 검색)으로 좁힐 때 이름·시수를 다시 짝지으려면 행이 필요하다
 *    — 이름 배열과 id 배열은 정렬·중복 제거를 거쳐 서로 짝이 아니라서 되짚을 수 없다.
 * ⚠️ **금액에 영향을 주지 않는 순수 부가정보**다(total·grossTuition·lines는 그대로).
 */
export type TierSettlementExcluded = {
  studentId: string;
  studentName: string;
  /** 이 행이 들고 있던 시수 — 제외 시수 합의 재료. */
  units: number;
  /** 티어 미지정 / 단가표에 없음 / 비율 미설정. */
  reason: "no-tier" | "no-price" | "no-rate";
  /** 티어 라벨(미지정이면 null). */
  tierLabel: string | null;
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
  /**
   * 단가(티어) 미지정인 **반·학생 줄** — `${classId}|${studentId}`(출석부 행 키와 같은 모양).
   * 🔴 단가는 **학생 × 반**마다 따로다(수강 `salary_tier`). 학생 id로만 표시하면 한 반만 비어도 그 학생의
   *    **모든 반 줄**에 「단가」가 붙는다(원장 2026-09-18 제보 — 표식이 회차 확정의 미확정·미배분보다 훨씬 많았다).
   *    금액·집계엔 영향 없는 표시용 키다.
   */
  missingTierRowKeys: string[];
  /** 단가표에 없는 티어 라벨(오타·미등록). */
  missingPriceTiers: string[];
  /** 비율을 못 정한 과정(그룹 비율·기본 비율 둘 다 없음). */
  missingRateGroups: string[];
  /** 제외된 시수 합(미지정·단가없음·비율없음) — "얼마나 빠졌는지"를 화면이 말할 수 있게. */
  excludedUnits: number;
  /** 제외된 행 내역 — 위 세 집계값의 원재료(부분집합 재집계용). 금액엔 영향 없음. */
  excludedLines: TierSettlementExcluded[];
};

/** 제외 행의 공통 부분 — 사유·티어만 호출부가 채운다. */
function excludedOf(row: TierRow): Pick<TierSettlementExcluded, "studentId" | "studentName" | "units"> {
  return { studentId: row.studentId, studentName: row.studentName, units: row.units };
}

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
  const excludedLines: TierSettlementExcluded[] = [];
  const missingTierStudents = new Set<string>();
  const missingTierStudentIds = new Set<string>();
  const missingTierRowKeys = new Set<string>();
  const missingPriceTiers = new Set<string>();
  const missingRateGroups = new Set<string>();

  for (const row of rows) {
    if (row.units <= 0) continue;
    // 🔑 단가 출처: 회차 확정 단가가 있으면 그것(원장 2026-09-18 통일), 없으면 수강 티어 단가표(종전).
    const session = row.sessionPrice != null && row.sessionPrice > 0 ? row.sessionPrice : null;
    let price: number;
    let group: SalaryGroup | null;
    let label: string;
    if (session !== null) {
      // 티어가 있고 그 단가가 회차 단가와 **같으면** 종전 줄과 한 글자도 안 다르게(과정·라벨 그대로).
      // 다르면 회차 단가가 이긴다 — 과정도 그 단가에서 다시 읽는다(티어 라벨의 과정을 남기면 단가와 과정이 어긋난다).
      const sameTier = !!row.tierLabel && unitPriceByTier.get(row.tierLabel) === session;
      price = session;
      group = sameTier
        ? tierSalaryGroup(row.tierLabel)
        : salaryGroupForPrice(session, row.classGroup ?? null, unitPriceByTier);
      label = sameTier ? row.tierLabel! : SESSION_PRICE_LABEL;
    } else {
      if (!row.tierLabel) {
        missingTierStudents.add(row.studentName);
        missingTierStudentIds.add(row.studentId);
        missingTierRowKeys.add(`${row.classId}|${row.studentId}`);
        excludedUnits += row.units;
        excludedLines.push({ ...excludedOf(row), reason: "no-tier", tierLabel: null });
        continue;
      }
      const tierPrice = unitPriceByTier.get(row.tierLabel);
      if (tierPrice === undefined || tierPrice <= 0) {
        missingPriceTiers.add(row.tierLabel);
        excludedUnits += row.units;
        excludedLines.push({ ...excludedOf(row), reason: "no-price", tierLabel: row.tierLabel });
        continue;
      }
      price = tierPrice;
      group = tierSalaryGroup(row.tierLabel);
      label = row.tierLabel;
    }
    const rate = group != null && rates.groupRates?.[group] != null
      ? rates.groupRates[group]!
      : rates.defaultRate;
    if (rate === null || rate === undefined) {
      missingRateGroups.add(group ?? label);
      excludedUnits += row.units;
      excludedLines.push({ ...excludedOf(row), reason: "no-rate", tierLabel: label });
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
      tierLabel: label,
      units: row.units,
      unitPrice: price,
      priceSource: session !== null ? "session" : "tier",
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
    missingTierRowKeys: [...missingTierRowKeys],
    missingPriceTiers: [...missingPriceTiers].sort((a, b) => a.localeCompare(b, "ko")),
    missingRateGroups: [...missingRateGroups],
    excludedUnits,
    excludedLines,
  };
}
