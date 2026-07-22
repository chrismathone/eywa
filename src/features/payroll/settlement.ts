// 강사 정산(급여) 산출 — 순수 함수(Vitest + 골든마스터 N6). 급여 연계 v1. docs/payroll-linkage-plan.md.
//
// splits(invoice_teacher_splits, 0117a)의 확정치를 강사별 급여로 환산한다.
// - **지급 기준액 = min(실측 actual_amount, 청구 confirmed_amount)** — 원장 확정 2026-07-21(구 급여 시트와 동일):
//   *"실제 수업한 기준으로 급여가 발생해야 한다. 수업을 안 했는데 급여가 나가면 안 된다. 아무리 많이 수업해도
//    청구액을 넘어서는 분은 지급하지 않는다(시수 차이가 +로 남는다)."*
//   ⚠️ 2026-07-17의 "지급 기준 = confirmed, actual은 신호로만"을 **원장이 명시적으로 뒤집은 것**이다. 되돌리지 말 것.
//   ⚠️ min은 **선택**이지 합산이 아니다 — confirmed와 actual을 더하는 것은 여전히 금지(P2/R3 +60.5M 사고).
// - 급여 모델 = 강사별 개별(비율제/급여제/혼합). users.salary_type + commission_rate(0119a).
// - 귀속 = teacher_id(동명이인 병합 금지, P3). 미배정·미설정은 지어내지 않고 가시화(P4/N4).
// - confirmed와 actual은 절대 합산 금지(P2/R3, +60.5M 이중계상 사고).
//
// ⚠️ v1은 읽기전용 참고 — 이 산출값은 어디에도 저장하지 않는다(payroll_records 미기록).

import { resolveClassRate, type GroupRates } from "./salary-group";

export type SalaryType = "commission" | "fixed" | "hybrid";

/** 강사 급여 정책(users 0119a). */
export type TeacherComp = {
  salaryType: SalaryType | null; // null = 미설정
  commissionRate: number | null; // **기본** 배분율 %(과정별·반별이 없을 때). null = 미설정
  monthlyBase: number; // 고정/기본급(fixed/hybrid). 원
  /** 과정별 배분율(초·중·고·수능·특강). 기본 비율보다 우선. */
  groupRates?: GroupRates | null;
};

/** 정산 입력 한 행 = splits 한 행(청구서×반). */
export type SettlementRowInput = {
  teacherId: string | null; // null = 미배정
  teacherName: string | null;
  classId: string | null;
  confirmedAmount: number; // 청구 기준(splits.confirmed_amount) — 지급 상한(캡)
  /** 실측 기준(splits.actual_amount) = 실제 수업한 차수 × 단가. 지급 기준액의 후보. */
  actualAmount: number;
  /** 실측이 아직 없으면 true — 캡만 적용하고 실측으로 깎지 않는다(0을 지어내지 않기 위해). */
  actualMissing?: boolean;
  /** 반 이름 — 과정 자동 판정(초등M…)에 쓴다. 없으면 미분류. */
  className?: string | null;
  /** 반별 수동 과정 지정(class_salary_settings). 이름 자동 판정을 이긴다. */
  manualGroup?: string | null;
  /** 반별 수동 배분율 %(class_salary_settings). 과정별·기본보다 우선. */
  classRate?: number | null;
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
  /** 과정별 배분율 — 편집기가 현재 값을 다시 그리기 위해 그대로 실어 보낸다. */
  groupRates: GroupRates | null;
  monthlyBase: number;
  /** 지급 기준액 합 = Σ min(실측, 청구). 청구·실측과 별개로 "실제로 비율이 곱해지는 금액". */
  payableTotal: number;
  /** 수수료 차감 후 배분 기준액 = round(payableTotal × NET_MULTIPLIER). 화면이 산식을 보여주기 위한 중간값. */
  netBase: number;
  commissionAmount: number; // 배분액 = round(Σ 반별 지급기준 × 0.911 × 반별 rate/100). 해당 없으면 0
  settlement: number | null; // 산정 급여. null = 산정 불가(unset/unassigned/missing_rate)
  status: SettlementStatus;
  /** 비율을 정하지 못한 반 이름들 — "어느 반 때문에 보류인지"를 화면이 말할 수 있게(0 지어내기 금지). */
  unresolvedClasses: string[];
};

const UNASSIGNED = "미배정";

/**
 * 결제 수수료 8.9% — **원장 확정 산식(2026-07-21): 급여 = 매출(청구) × 0.911 × 비율.**
 * ⚠️ 결제수단을 가리지 않고 **전 건 일괄** 적용한다(원장 지시). 카드만 빼거나 현금을 예외 처리하지 말 것.
 * ⚠️ 이 상수를 바꾸면 급여가 통째로 바뀐다 — 골든마스터(billing/golden)를 반드시 함께 갱신하고 사유를 남길 것.
 */
export const PLATFORM_FEE_RATE = 0.089;
export const NET_MULTIPLIER = 1 - PLATFORM_FEE_RATE; // 0.911

/** 지급 기준액에서 수수료를 뗀 배분 기준액(정수 반올림). */
export function netBaseOf(payableTotal: number): number {
  return Math.round(payableTotal * NET_MULTIPLIER);
}

/**
 * 한 행의 **지급 기준액** = min(실제 수업분, 청구액).
 * · 덜 수업했으면 수업한 만큼(실측) · 더 수업했어도 청구액이 상한(초과분은 시수 차이 +로 남고 지급 안 함).
 * ⚠️ 실측이 아직 없는 행(시수 검증 전)은 실측 0으로 보고 급여를 0으로 만들면 안 된다 — 캡(청구액)만 적용한다.
 */
export function payableOf(row: Pick<SettlementRowInput, "confirmedAmount" | "actualAmount" | "actualMissing">): number {
  if (row.actualMissing) return row.confirmedAmount;
  return Math.min(row.actualAmount, row.confirmedAmount);
}

/**
 * 반별 배분액 합 = Σ(반 청구 × 0.911 × 반 비율%) — **마지막에 한 번만 반올림**.
 * 비율을 못 정한 반이 하나라도 있으면 null(=보류) — 일부만 계산한 값을 진짜 급여처럼 보여주지 않는다.
 * 못 정한 반 이름은 `sink`에 모아 화면이 "어느 반 때문인지"를 말할 수 있게 한다.
 */
function commissionOfRows(rows: SettlementRowInput[], comp: TeacherComp, sink: string[]): number | null {
  let raw = 0;
  for (const r of rows) {
    const { rate } = resolveClassRate({
      className: r.className,
      manualGroup: r.manualGroup,
      classRate: r.classRate,
      groupRates: comp.groupRates,
      defaultRate: comp.commissionRate,
    });
    if (rate === null) {
      const label = (r.className ?? "").trim() || "(반 이름 없음)";
      if (!sink.includes(label)) sink.push(label);
      continue;
    }
    raw += (payableOf(r) * NET_MULTIPLIER * rate) / 100;
  }
  return sink.length > 0 ? null : Math.round(raw);
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
    {
      teacherId: string | null;
      teacherName: string | null;
      classIds: Set<string>;
      rowCount: number;
      confirmedTotal: number;
      actualTotal: number;
      payableTotal: number;
      rows: SettlementRowInput[]; // 반별 비율을 곱하려면 행을 남겨둬야 한다(합계에 단일 rate를 곱하면 안 됨)
    }
  >();

  for (const r of rows) {
    const key = r.teacherId ?? UNASSIGNED;
    let g = groups.get(key);
    if (!g) {
      g = { teacherId: r.teacherId, teacherName: r.teacherName, classIds: new Set(), rowCount: 0, confirmedTotal: 0, actualTotal: 0, payableTotal: 0, rows: [] };
      groups.set(key, g);
    }
    g.rowCount++;
    g.rows.push(r);
    if (r.classId) g.classIds.add(r.classId);
    g.confirmedTotal += r.confirmedAmount;
    g.actualTotal += r.actualAmount;
    g.payableTotal += payableOf(r);
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
    const unresolvedClasses: string[] = [];

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
      // commission | hybrid — **반마다** 배분율이 다를 수 있다(반별 수동 > 과정별 > 기본).
      // ⚠️ 합계에 단일 rate를 곱하지 말 것. 반올림도 행마다 하지 않고 **마지막에 한 번**(원 단위 흔들림 방지).
      const commission = commissionOfRows(g.rows, comp, unresolvedClasses);
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
      payableTotal: g.payableTotal,
      netBase: netBaseOf(g.payableTotal),
      salaryType: comp.salaryType,
      commissionRate: comp.commissionRate,
      groupRates: comp.groupRates ?? null,
      monthlyBase: comp.monthlyBase,
      commissionAmount,
      settlement,
      status,
      unresolvedClasses,
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
