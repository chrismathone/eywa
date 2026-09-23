// 수납 라인 펼치기·표시 라벨 — 화면(billing-table)과 엑셀(invoices-excel)이 **같은 한 벌**을 쓴다(감사 N3).
// ⚠️ "server-only" 금지 — 클라이언트 표도 import한다.
import type { InvoiceLineItem } from "./invoice-line-items";
import { invoiceOutstanding } from "./calc";

/** 라인 펼치기에 필요한 청구서 칸만(InvoiceRow의 부분 집합 — 서버 모듈 의존 없이). */
export type InvoiceForLines = {
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  notes: string | null;
  lineItems: InvoiceLineItem[];
  paymentMethod: string | null;
  pointsUsed: number;
  paidAt: string | null;
};

// InvoiceRow(집계) → 라인 단위 행 목록. 구데이터(항목 상세 없음)는 인보이스 값으로 1행 폴백.
// ⚠️ 라인은 있는데 상세 키(paid/unpaid)가 전무한 구형 3-key 인보이스(재적재 이전·aywa 폼 산)는
// 라인별 미납을 알 수 없다 — 그대로 두면 `unpaid ?? 0`이 전부 '완납'으로 렌더(실측 미납 28건 ₩7.3M 은폐).
// → 항목명·금액은 살리고 **첫 라인에만 인보이스 값(할인/실납/미납 등)을 합성**, 나머지는 미상(—) 처리.
export function invoiceDisplayLines(r: InvoiceForLines): InvoiceLineItem[] {
  const invoiceLevel = {
    discount: r.amountDiscount,
    paid: r.amountPaid,
    // 행 레벨 미수 = calc.ts 단일 공식(paid/refunded/void = 0 — 적립금 잔차를 미납으로 안 그림).
    unpaid: invoiceOutstanding(r),
    points: r.pointsUsed,
    method: r.paymentMethod,
    paidDate: r.paidAt,
  };
  if (r.lineItems.length > 0) {
    const hasDetail = r.lineItems.some((li) => li.paid !== undefined || li.unpaid !== undefined);
    if (hasDetail) return r.lineItems;
    return r.lineItems.map((li, i) => (i === 0 ? { ...li, ...invoiceLevel } : li));
  }
  return [{ kind: "수업", description: r.notes ?? "수납", amount: r.amountTotal, ...invoiceLevel }];
}

// 레거시 영문 kind(재적재 이전 aywa 폼·구 임포터 산: tuition/material/exam/other) → 한글 표시(raw 코드 노출 금지).
const KIND_LEGACY_LABEL: Record<string, string> = {
  tuition: "수업",
  material: "교재",
  exam: "시험",
  other: "기타",
};
export const invoiceKindLabel = (k: string) => KIND_LEGACY_LABEL[k] ?? k;

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
};
export const paymentMethodLabel = (m: string | null | undefined): string =>
  m ? (PAYMENT_METHOD_LABEL[m] ?? m) : "";

/**
 * **aywa에서 직접 만든(수동) 청구서**인가 — 감사 N15. 동기화 스크립트 `invoice-stale.cjs isMakeeduShape`의 **반대, 같은 규칙**:
 * makeedu 라인은 수납 상세(paid/unpaid)를 갖거나(현행) kind가 한글 구분(수업/교재…, 07-01 옛 스키마)이다.
 * 수동 청구(createInvoice)는 kind가 영문 카테고리(tuition/material/…)이고 수납 상세가 없다. 라인이 없으면 수동으로 보지 않는다
 * (정체를 모르는 행을 사람이 바꾸게 두지 않는다 — 안전한 쪽).
 * ⚠️ 원본(raw jsonb)·정규화 행 둘 다 받는다 — 정규화 행은 키가 `undefined`로 있으므로 `in`이 아니라 값으로 본다.
 */
export function isManualInvoiceShape(lineItems: unknown): boolean {
  const li = Array.isArray(lineItems) ? lineItems : [];
  if (li.length === 0) return false;
  const makeedu = li.some((it) => {
    if (!it || typeof it !== "object") return false;
    const o = it as Record<string, unknown>;
    return o.paid !== undefined || o.unpaid !== undefined || /[가-힣]/.test(String(o.kind ?? ""));
  });
  return !makeedu;
}
