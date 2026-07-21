// 강사 정산(급여) 산출 — 순수 함수(Vitest + 골든마스터 N6). 급여 연계 v1. docs/payroll-linkage-plan.md.
//
// splits(invoice_teacher_splits, 0117a)의 확정치를 강사별 급여로 환산한다. 원장 결정(2026-07-17):
// - 지급 기준 = confirmed_amount(청구 기준). actual_amount/diff는 **검토 신호로만**(자동 조정 없음, N2).
// - 급여 모델 = 강사별 개별(비율제/급여제/혼합). users.salary_type + commission_rate(0119a).
// - 귀속 = teacher_id(동명이인 병합 금지, P3). 미배정·미설정은 지어내지 않고 가시화(P4/N4).
// - confirmed와 actual은 절대 합산 금지(P2/R3, +60.5M 이중계상 사고).
//
// ⚠️ v1은 읽기전용 참고 — 이 산출값은 어디에도 저장하지 않는다(payroll_records 미기록).

export type SalaryType = "commission" | "fixed" | "hybrid";

/** 강사 급여 정책(users 0119a). */
export type TeacherComp = {
  salaryType: SalaryType | null; // null = 미설정
  commissionRate: number | null; // 배분율 %(commission/hybrid). null = 미설정
  monthlyBase: number; // 고정/기본급(fixed/hybrid). 원
};

/** 정산 입력 한 행 = splits 한 행(청구서×반). */
export type SettlementRowInput = {
  teacherId: string | null; // null = 미배정
  teacherName: string | null;
  classId: string | null;
  confirmedAmount: number; // 청구 기준(splits.confirmed_amount)
  actualAmount: number; // 실측 기준(splits.actual_amount) — 신호로만
};

export type SettlementStatus =
  | "computed" // 산정 완료
  | "unset" // 급여 방식 미설정(정책 없음)
  | "unassigned" // 담당 강사 미배정(teacher_id 없음)
  | "missing_rate" // 비율제/혼합인데 배분율 미입력
  | "missing_base"; // 급여제인데 기본급 미입력(0을 '산정 완료'로 오표시 방지)

export type TeacherSettlement = {
  teacherId: string | null;
  teacherName: string; // 미배정 = "미배정"
  classCount: number;
  rowCount: number;
  confirmedTotal: number; // Σ 청구 기준
  actualTotal: number; // Σ 실측 기준(신호)
  diffTotal: number; // 실측 − 청구(신호)
  salaryType: SalaryType | null;
  commissionRate: number | null;
  monthlyBase: number;
  /** 수수료 차감 후 배분 기준액 = round(confirmedTotal × NET_MULTIPLIER). 화면이 산식을 보여주기 위한 중간값. */
  netBase: number;
  commissionAmount: number; // 배분액 = round(confirmedTotal × 0.911 × rate/100). 해당 없으면 0
  settlement: number | null; // 산정 급여. null = 산정 불가(unset/unassigned/missing_rate)
  status: SettlementStatus;
};

const UNASSIGNED = "미배정";

/**
 * 결제 수수료 8.9% — **원장 확정 산식(2026-07-21): 급여 = 매출(청구) × 0.911 × 비율.**
 * ⚠️ 결제수단을 가리지 않고 **전 건 일괄** 적용한다(원장 지시). 카드만 빼거나 현금을 예외 처리하지 말 것.
 * ⚠️ 이 상수를 바꾸면 급여가 통째로 바뀐다 — 골든마스터(billing/golden)를 반드시 함께 갱신하고 사유를 남길 것.
 */
export const PLATFORM_FEE_RATE = 0.089;
export const NET_MULTIPLIER = 1 - PLATFORM_FEE_RATE; // 0.911

/** 청구액에서 수수료를 뗀 배분 기준액(정수 반올림). */
export function netBaseOf(confirmedTotal: number): number {
  return Math.round(confirmedTotal * NET_MULTIPLIER);
}

/**
 * 배분액 = 청구 × 0.911 × rate% (정수 반올림). rate null이면 null.
 * ⚠️ 반올림은 **마지막에 한 번만** — 수수료 단계에서 먼저 반올림하면 강사마다 원 단위가 흔들린다.
 */
function commissionOf(confirmedTotal: number, rate: number | null): number | null {
  if (rate === null) return null;
  return Math.round((confirmedTotal * NET_MULTIPLIER * rate) / 100);
}

/**
 * splits 행들을 담당 강사(teacher_id) 단위로 묶어 급여를 산정. comp는 teacherId → 정책.
 * 미배정/미설정/배분율 누락은 settlement=null로 가시화(0으로 지어내지 않음).
 */
export function computeTeacherSettlements(
  rows: SettlementRowInput[],
  compByTeacherId: Map<string, TeacherComp>,
): TeacherSettlement[] {
  const groups = new Map<
    string,
    { teacherId: string | null; teacherName: string | null; classIds: Set<string>; rowCount: number; confirmedTotal: number; actualTotal: number }
  >();

  for (const r of rows) {
    const key = r.teacherId ?? UNASSIGNED;
    let g = groups.get(key);
    if (!g) {
      g = { teacherId: r.teacherId, teacherName: r.teacherName, classIds: new Set(), rowCount: 0, confirmedTotal: 0, actualTotal: 0 };
      groups.set(key, g);
    }
    g.rowCount++;
    if (r.classId) g.classIds.add(r.classId);
    g.confirmedTotal += r.confirmedAmount;
    g.actualTotal += r.actualAmount;
    // 표시 이름은 첫 non-null 유지(스냅샷 이름)
    if (!g.teacherName && r.teacherName) g.teacherName = r.teacherName;
  }

  const out: TeacherSettlement[] = [];
  for (const g of groups.values()) {
    const comp: TeacherComp = g.teacherId
      ? compByTeacherId.get(g.teacherId) ?? { salaryType: null, commissionRate: null, monthlyBase: 0 }
      : { salaryType: null, commissionRate: null, monthlyBase: 0 };

    let settlement: number | null;
    let status: SettlementStatus;
    let commissionAmount = 0;

    if (!g.teacherId) {
      settlement = null;
      status = "unassigned";
    } else if (comp.salaryType === null) {
      settlement = null;
      status = "unset";
    } else if (comp.salaryType === "fixed") {
      // 기본급 미입력(0)을 '산정 완료 0원'으로 오표시하지 않는다 — 미과금 사고 방지(비율제 missing_rate 대칭).
      if (comp.monthlyBase <= 0) {
        settlement = null;
        status = "missing_base";
      } else {
        settlement = comp.monthlyBase;
        status = "computed";
      }
    } else {
      // commission | hybrid — 배분율 필요
      const commission = commissionOf(g.confirmedTotal, comp.commissionRate);
      if (commission === null) {
        settlement = null;
        status = "missing_rate";
      } else {
        commissionAmount = commission;
        settlement = comp.salaryType === "hybrid" ? comp.monthlyBase + commission : commission;
        status = "computed";
      }
    }

    out.push({
      teacherId: g.teacherId,
      teacherName: g.teacherId ? g.teacherName?.trim() || "이름 없음" : UNASSIGNED,
      classCount: g.classIds.size,
      rowCount: g.rowCount,
      confirmedTotal: g.confirmedTotal,
      actualTotal: g.actualTotal,
      diffTotal: g.actualTotal - g.confirmedTotal,
      netBase: netBaseOf(g.confirmedTotal),
      salaryType: comp.salaryType,
      commissionRate: comp.commissionRate,
      monthlyBase: comp.monthlyBase,
      commissionAmount,
      settlement,
      status,
    });
  }

  return out.sort(
    (a, b) =>
      // 미배정 맨 뒤 → 산정 급여 큰 순 → 청구 총액 큰 순 → 이름
      Number(a.status === "unassigned") - Number(b.status === "unassigned") ||
      (b.settlement ?? -1) - (a.settlement ?? -1) ||
      b.confirmedTotal - a.confirmedTotal ||
      a.teacherName.localeCompare(b.teacherName, "ko"),
  );
}

export type SettlementTotals = {
  teacherCount: number; // 산정된 강사 수(computed만)
  settledTotal: number; // Σ 산정 급여(computed만)
  confirmedTotal: number; // Σ 청구 기준(전체)
  pendingCount: number; // 미설정·배분율누락·미배정 등 산정 보류 그룹 수
};

/** 정산 합계 — 산정된 급여만 합산(미설정/미배정은 보류로 카운트). */
export function totalSettlements(rows: TeacherSettlement[]): SettlementTotals {
  let settledTotal = 0;
  let teacherCount = 0;
  let pendingCount = 0;
  let confirmedTotal = 0;
  for (const r of rows) {
    confirmedTotal += r.confirmedTotal;
    if (r.settlement !== null) {
      settledTotal += r.settlement;
      teacherCount++;
    } else {
      pendingCount++;
    }
  }
  return { teacherCount, settledTotal, confirmedTotal, pendingCount };
}
