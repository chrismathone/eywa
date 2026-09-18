import { classInvoiceAmount, type LineItemLike } from "@/features/billing/session-terms/class-amount";
import { effectiveAllocations, receiptLines } from "@/features/billing/session-terms/receipt-allocation";
import { round1 } from "./session-units";
import { rowKey } from "./grid/model";

export type AttendanceInvoice = { id: string; student_id: string; line_items: unknown };
export type AttendanceBillingTerm = {
  id: string;
  invoice_id: string;
  class_id: string | null;
  amount: number | null;
  confirmed_sessions: number | null;
  /**
   * 확정 시 저장한 회당 단가(월 정액이면 월 금액) — 확정 해제면 null. 「단가」 표식 연동 재료(원장 2026-09-18).
   * ⚠️ 선택 필드 — 금액·차수 계산은 이 값을 안 읽는다(청구액은 배분·반 매칭, 차수는 `confirmed_sessions`).
   */
  unit_price?: number | null;
  allocation_line_index: number | null;
  allocation_amount: number | null;
  allocation_source: unknown;
  allocation_base_amount: number | null;
  /** 확정 당시 세는 단위 — `attendance_units`(시수)가 아니면 **옛 일수 기준**이다(null도 일수, 회차 확정과 같은 폴백). */
  quantity_basis: string | null;
  /** 월 정액(EiE)은 일수·시수 축이 아예 없다 — 일수 기준 표식에서 뺀다(회차 확정 화면과 같은 규약). */
  pricing_mode: string | null;
};
export type AttendanceBillingClass = { classId: string; className: string; studentIds: readonly string[] };

/** 회차 확정의 '이 반 청구액'과 동일: 유효한 배분 우선, 없으면 반 이름 매칭. */
export function attendanceClassBilledAmounts(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): Record<string, number> {
  const classById = new Map(classes.map((c) => [c.classId, { ...c, students: new Set(c.studentIds) }]));
  const termsByInvoice = new Map<string, AttendanceBillingTerm[]>();
  for (const term of terms) {
    const rows = termsByInvoice.get(term.invoice_id) ?? [];
    rows.push(term);
    termsByInvoice.set(term.invoice_id, rows);
  }
  const out: Record<string, number> = {};
  for (const invoice of invoices) {
    const invoiceTerms = termsByInvoice.get(invoice.id) ?? [];
    // 같은 청구 항목을 나누는 다른 반까지 검증한 뒤 표시할 반만 고른다.
    const allocated = effectiveAllocations(receiptLines(invoice.line_items), invoiceTerms.map((term) => ({
      id: term.id,
      amount: term.amount === null ? null : Number(term.amount),
      confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null,
      allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source,
      baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    const lineItems = (Array.isArray(invoice.line_items) ? invoice.line_items : []) as LineItemLike[];
    for (const term of invoiceTerms) {
      const cls = term.class_id ? classById.get(term.class_id) : undefined;
      if (!cls?.students.has(invoice.student_id)) continue;
      const amount = allocated.get(term.id) ?? classInvoiceAmount(cls.className, lineItems);
      if (amount === null) continue;
      const key = rowKey(cls.classId, invoice.student_id);
      out[key] = (out[key] ?? 0) + amount;
    }
  }
  return out;
}

/**
 * 학생×반 등록 차수 한 칸 — 값과 **그 값의 단위**.
 * 🔴 `daysBasis`는 "이 숫자는 시수가 아니라 **출석 일수**"라는 뜻이다(회차 확정이 붉게 칠하는 그 값).
 */
export type AttendanceTermSessions = { units: number; daysBasis: boolean };

/** 확정 당시 단위 — 회차 확정 화면과 **같은 폴백**(null이면 옛 일수 기준). 월 정액은 이 축이 없다. */
function isDaysBasisTerm(term: AttendanceBillingTerm): boolean {
  if (term.pricing_mode === "monthly") return false;
  return (term.quantity_basis ?? "days") === "days";
}

/**
 * 학생×반 **등록 차수** — 회차 확정(`invoice_session_terms.confirmed_sessions`)에서 확정한 시수(원장 2026-09-17
 * *"등록 차수 열 추가하고. 그걸 회차 확정에서 확정된 시수로 보여줄것"*).
 *
 * 🔴 **확정한 것만** 담는다 — 미확정(null)은 키를 만들지 않는다(화면이 '미확정'으로 적는다). 0을 지어내면
 *    "등록 0차수"가 확정된 사실처럼 읽힌다.
 * 🔴 **옛 일수 기준 확정은 단위가 다르다** — 회차 확정 화면이 붉은 숫자 + 카드로 *"재확정 필요"*라 적는 그 값이라
 *    (원장 2026-09-16), 여기서도 `daysBasis`로 표시해 넘긴다. 감추거나 '미확정'으로 바꾸지 말 것(둘 다 거짓이다).
 * ⚠️ 같은 학생·반에 청구서가 둘이면(재발행·중복) **합친다** — 청구액과 같은 규약(위 함수도 더한다).
 *    합은 `round1`을 지난다(1.1을 여러 번 더하면 꼬리가 남아 "1"이 "1.0"으로 찍힌다).
 */
export function attendanceClassConfirmedSessions(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): Record<string, AttendanceTermSessions> {
  const classById = new Map(classes.map((c) => [c.classId, { ...c, students: new Set(c.studentIds) }]));
  const studentByInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  const out: Record<string, AttendanceTermSessions> = {};
  for (const term of terms) {
    if (term.confirmed_sessions === null || !term.class_id) continue;
    const studentId = studentByInvoice.get(term.invoice_id);
    const cls = classById.get(term.class_id);
    if (!studentId || !cls?.students.has(studentId)) continue;
    const key = rowKey(cls.classId, studentId);
    const prev = out[key];
    out[key] = {
      units: round1((prev?.units ?? 0) + Number(term.confirmed_sessions)),
      // 하나라도 옛 일수 기준이면 그 합은 단위가 섞였다 — 섞였다는 사실을 알린다.
      daysBasis: (prev?.daysBasis ?? false) || isDaysBasisTerm(term),
    };
  }
  return out;
}

/**
 * 회차 확정에서 **단가까지 확정된** 학생×반 줄(`rowKey`) — 출석부 「단가」 표식을 떼는 재료(원장 2026-09-18
 * *"회차 확정의 단가가 확정되었으면 출석부 단가 라벨 지울것. 해당 단가와 연동하면 될듯"*).
 *
 * 🔴 그 줄의 회차 행이 **전부** 확정(`confirmed_sessions`)이고 단가(`unit_price`)가 있을 때만 담는다 — 같은 학생·반에
 *    청구서가 둘이라 한쪽이 아직 미확정이면 회차 확정 화면엔 그 행이 '미확정'으로 남아 있다(표식도 남긴다).
 * 🔴 회차 행이 없는 줄(청구서 없음·반 미매칭)은 안 담는다 — 확정한 사실이 없다.
 * ⚠️ **표시 전용**이다 — 정산액은 이 값을 읽지 않는다. 수학 반의 정산 단가는 정산 조립이 **따로** 회차 단가를 읽는다
 *    ([`collectTierRows`](@/features/payroll/server/tier-rows) — 같은 날 원장 결정). 그래서 수학 줄은 이 목록이 없어도
 *    표식이 빠지고, 이 목록이 떼는 것은 **영어 줄**(티어 정산 대상이 아니다)과 정산에 못 쓰는 확정분(옛 일수 기준 등)뿐이다.
 *    그 줄들은 정산에서 빠진 채라 합계 줄의 '단가 미지정 N명 · N시수 제외'는 계속 설 수 있다(그게 사실이다).
 */
export function attendanceClassPriceConfirmedRows(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): string[] {
  const classById = new Map(classes.map((c) => [c.classId, new Set(c.studentIds)]));
  const studentByInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  const state = new Map<string, boolean>();
  for (const term of terms) {
    if (!term.class_id) continue;
    const studentId = studentByInvoice.get(term.invoice_id);
    if (!studentId || !classById.get(term.class_id)?.has(studentId)) continue;
    const key = rowKey(term.class_id, studentId);
    const priced = term.confirmed_sessions !== null && term.unit_price != null;
    state.set(key, (state.get(key) ?? true) && priced);
  }
  return [...state].filter(([, ok]) => ok).map(([key]) => key);
}
