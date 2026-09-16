// 강사 분배(splits) 산출 — 순수 함수(Vitest + 골든마스터 N6).
// 로드맵 2단계 (b): 확정 회차(청구 기준)와 실 소비 회차(실측 기준 = 출석 일수, 0263a)의 강사 귀속 금액을 행 단위로 산출해
// invoice_teacher_splits(0117a)에 스냅샷 저장한다. attendance 사고 이식 규칙:
// - 돈은 **확정 행만**(N1): confirmed_sessions·unit_price 둘 다 있어야 분배 행이 된다(미확정=돈 아님).
// - pricingMode=monthly(EiE)는 확정한 월 금액에 배분율을 적용한다. 출석 회차는 금액에 곱하지 않는다.
// - 청구 기준(confirmedAmount)과 실측 기준(actualAmount)은 **같은 청구의 두 표현** — 절대 합산 금지(R3, +60.5M 사고).
//   diff는 점검 신호일 뿐 어느 쪽도 자동 수정하지 않는다(N2).
// - 반 단위 유지: (invoice × class) 1행 — 같은 강사의 두 반을 한 행으로 합치지 않는다(attendance R2 hasAny 사고).

import { sessionPricingAmount, type SessionPricingMode } from "../session-pricing";

export type SplitRowInput = {
  pricingMode?: SessionPricingMode;
  invoiceId: string;
  classId: string | null;
  subject: string;
  teacherId: string | null; // 분배 시점 담당 강사(스냅샷) — null=미배정
  teacherName: string | null;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null; // 확정 시점 저장 금액(회차×단가) — 있으면 우선
  actualConsumed: number; // 실 소비 **회차** = 출석 일수(0263a). 시수가 아니다.
};

export type ComputedSplit = {
  pricingMode: SessionPricingMode;
  invoiceId: string;
  classId: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  confirmedSessions: number;
  unitPrice: number;
  confirmedAmount: number; // 청구 기준 분배액 = amount ?? confirmed × unitPrice
  actualUnits: number; // 실 소비 **회차**(옛 이름 — DB 컬럼 actual_units이자 골든 픽스처 키라 이름만 그대로 둔다)
  actualAmount: number; // 실측 기준 분배액 = round(actual × unitPrice)
  diffAmount: number; // 실측 − 청구 (음수 = 덜 소비 = 과청구 신호)
};

/**
 * 시수 검증 행 → 저장할 분배 행. 확정 + 단가 있는 행만(그 외는 돈이 확정되지 않아 스킵 — 지어내지 않음).
 * classId 없는 행(반 미상)도 스킵: 분배 귀속 대상이 없다.
 */
export function computeSplitRows(rows: SplitRowInput[]): ComputedSplit[] {
  const out: ComputedSplit[] = [];
  for (const r of rows) {
    if (r.confirmedSessions === null || r.unitPrice === null || !r.classId) continue;
    const actualUnits = Math.round(r.actualConsumed * 10) / 10;
    const confirmedAmount = r.amount ?? sessionPricingAmount(r.pricingMode, r.confirmedSessions, r.unitPrice);
    // EiE 월 정액은 출석 회차와 무관한 월 기준액에 배분율을 적용한다(원장 2026-09-16).
    const actualAmount = r.pricingMode === "monthly" ? confirmedAmount : Math.round(actualUnits * r.unitPrice);
    out.push({
      pricingMode: r.pricingMode ?? "per_session",
      invoiceId: r.invoiceId,
      classId: r.classId,
      subject: r.subject,
      teacherId: r.teacherId,
      teacherName: r.teacherName?.trim() || null,
      confirmedSessions: r.confirmedSessions,
      unitPrice: r.unitPrice,
      confirmedAmount,
      actualUnits,
      actualAmount,
      diffAmount: actualAmount - confirmedAmount,
    });
  }
  return out.sort(
    (a, b) => a.invoiceId.localeCompare(b.invoiceId) || a.classId.localeCompare(b.classId),
  );
}

export type SplitTotals = {
  rowCount: number;
  confirmedAmount: number;
  actualAmount: number;
  diffAmount: number;
};

/**
 * 분배 지문 — 드리프트 감지용(합계만 비교하면 강사 재배정처럼 합이 상쇄되는 변경을 놓친다).
 * (invoice, class, teacher, 청구액, 실측액)을 정렬·연결한 결정적 문자열. 저장본과 현재 집계 양쪽에서
 * 같은 함수로 산출해 비교한다.
 */
export function splitsFingerprint(
  rows: (Pick<ComputedSplit, "invoiceId" | "classId" | "teacherId" | "confirmedAmount" | "actualAmount"> & { pricingMode?: SessionPricingMode })[],
): string {
  return rows
    .map((r) => `${r.invoiceId}/${r.classId}/${r.teacherId ?? "-"}/${r.confirmedAmount}/${r.actualAmount}/${r.pricingMode ?? "per_session"}`)
    .sort()
    .join("|");
}

/** 저장 전/후 대조용 합계 — 스냅샷 드리프트 감지(저장본과 현재 집계가 다르면 재저장 안내). */
export function totalSplits(rows: Pick<ComputedSplit, "confirmedAmount" | "actualAmount">[]): SplitTotals {
  const confirmedAmount = rows.reduce((s, r) => s + r.confirmedAmount, 0);
  const actualAmount = rows.reduce((s, r) => s + r.actualAmount, 0);
  return { rowCount: rows.length, confirmedAmount, actualAmount, diffAmount: actualAmount - confirmedAmount };
}
