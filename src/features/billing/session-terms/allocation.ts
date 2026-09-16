// 강사별 분배 집계(read-only 참고) — 순수 함수(Vitest).
// 회차 검증 행(확정 회차·단가·실 소비 회차)을 반 담당 강사 단위로 묶어
// "확정 금액(청구 기준) vs 실측 금액(실 회차×단가)"을 나란히 보여준다.
//
// 0267a부터 새 확정은 출석부 시수 합, 기존 확정은 저장한 일수 기준으로 대조한다.
// 수납을 연결하면 할인 전 배분금액이 급여 기준이며, 학부모 할인은 차감하지 않는다.
//
// ⚠️ 이것은 표시 전용 집계다 — 어디에도 저장하지 않는다(쓰기 0).
//    강사 분배를 DB에 쓰는 기능(invoice_teacher_splits)은 골든마스터(N6) 통과 전 착수 금지(불변).
// 금액 규칙: 확정 금액 = 저장된 amount(확정 시점 회차×단가) 우선, 없으면 confirmed×unitPrice.
//            실측 금액 = round(실 회차 × unitPrice) — 행 단위 반올림(소수 값 × 홀수 단가 방어).
//            단가 없는 행은 금액 집계에서 제외하고 개수로 정직하게 표시(지어내지 않음).

import { sessionPricingAmount, type SessionPricingMode } from "../session-pricing";

export type AllocationRowInput = {
  pricingMode?: SessionPricingMode;
  className: string | null;
  // 그룹 키 = teacherId(동명이인 강사 병합 방지 — 이름 문자열 그룹핑 금지). name은 표시 라벨.
  teacherId: string | null; // null = 담당 강사 없음(미배정 반·반 미매칭)
  teacherName: string | null;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null; // 확정 시점 저장 금액(회차×단가)
  actualConsumed: number; // 확정 시점 quantity_basis에 맞춘 소비량
  allocatedAmount?: number | null;
};

export type TeacherAllocation = {
  teacherName: string; // 미배정 = "미배정"
  classCount: number;
  rowCount: number;
  confirmedSessions: number; // 확정 회차 합(확정 행만)
  confirmedAmount: number; // 확정 금액 합(원)
  actualUnits: number; // 실 소비량 합
  actualAmount: number; // 실측 금액 합(원) — 단가 있는 행만
  diffAmount: number; // 실측 − 확정
  missingPriceRows: number; // 단가 없어 금액 집계 제외된 행 수
  pricedRows: number; // 0원 단가도 계산 가능한 행이다.
  missingConfirmedRows: number;
  confirmedPricedRows: number;
};

const UNASSIGNED = "미배정";

export function aggregateTeacherAllocations(rows: AllocationRowInput[]): TeacherAllocation[] {
  const byTeacher = new Map<
    string,
    TeacherAllocation & { classNames: Set<string> }
  >();

  for (const r of rows) {
    const key = r.teacherId ?? UNASSIGNED;
    let agg = byTeacher.get(key);
    if (!agg) {
      agg = {
        teacherName: r.teacherId ? r.teacherName?.trim() || "이름 없음" : UNASSIGNED,
        classCount: 0,
        rowCount: 0,
        confirmedSessions: 0,
        confirmedAmount: 0,
        actualUnits: 0,
        actualAmount: 0,
        diffAmount: 0,
        missingPriceRows: 0,
        pricedRows: 0,
        missingConfirmedRows: 0,
        confirmedPricedRows: 0,
        classNames: new Set<string>(),
      };
      byTeacher.set(key, agg);
    }
    agg.rowCount++;
    if (r.unitPrice !== null) agg.pricedRows++;
    if (r.className) agg.classNames.add(r.className);

    if (r.confirmedSessions !== null) {
      agg.confirmedSessions += r.confirmedSessions;
      if (r.amount !== null || r.unitPrice !== null) agg.confirmedPricedRows++;
      else if (r.confirmedSessions > 0) agg.missingConfirmedRows++;
      const confirmedAmount =
        r.allocatedAmount ?? r.amount ?? (r.unitPrice !== null ? sessionPricingAmount(r.pricingMode, r.confirmedSessions, r.unitPrice) : 0);
      agg.confirmedAmount += confirmedAmount;
    }

    agg.actualUnits = Math.round((agg.actualUnits + r.actualConsumed) * 10) / 10;
    if (r.unitPrice !== null) {
      agg.actualAmount += r.pricingMode === "monthly"
        ? (r.confirmedSessions !== null ? r.allocatedAmount ?? r.amount ?? r.unitPrice : 0)
        : r.allocatedAmount != null ? (r.confirmedSessions && r.confirmedSessions > 0 ? Math.round(r.allocatedAmount * r.actualConsumed / r.confirmedSessions) : 0)
        : Math.round(r.actualConsumed * r.unitPrice);
    } else if (r.actualConsumed > 0) {
      agg.missingPriceRows++;
    }
  }

  return [...byTeacher.values()]
    .map(({ classNames, ...a }) => ({
      ...a,
      classCount: classNames.size,
      diffAmount: a.actualAmount - a.confirmedAmount,
    }))
    .sort(
      (a, b) =>
        // 미배정은 맨 뒤, 나머지는 확정 금액 큰 순 → 이름순
        Number(a.teacherName === UNASSIGNED) - Number(b.teacherName === UNASSIGNED) ||
        b.confirmedAmount - a.confirmedAmount ||
        a.teacherName.localeCompare(b.teacherName, "ko"),
    );
}

export function allocationCoverage(t: Pick<TeacherAllocation, "missingPriceRows" | "pricedRows">): "complete" | "partial" | "unavailable" {
  if (t.missingPriceRows === 0) return "complete";
  return t.pricedRows > 0 ? "partial" : "unavailable";
}

/** 표시할 가치가 있는 행 — 전부 0(미확정·출석 0·단가없음 0)인 강사는 노이즈라 표에서 제외. */
export function hasAllocationSignal(t: TeacherAllocation): boolean {
  return (
    t.confirmedSessions !== 0 ||
    t.confirmedAmount !== 0 ||
    t.actualUnits !== 0 ||
    t.actualAmount !== 0 ||
    t.missingPriceRows !== 0
  );
}
