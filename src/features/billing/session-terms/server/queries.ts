import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { classInvoiceAmount, type LineItemLike } from "../class-amount";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isEieMonthlyClass, sessionPriceOptions, type SessionPrice, type SessionPricingMode } from "@/features/billing/session-pricing";
import { effectiveAllocations, receiptLines } from "../receipt-allocation";
import { loadLivePlans, type PlanHistory } from "./live-plans";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { receiptOriginalItems, receiptRefundState, type ReceiptRefundState } from "../receipt-refund";
import { receiptMatchesClass } from "../receipt-suggestion";

/** 회차 확정 면 한 행 — 청구서×반(반마다 단가가 달라 합산 금지). subject는 raw key(라벨은 소비처가 buildSubjectMaps로). */
export type SessionTermRow = {
  id: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  subject: string;
  classId: string | null;
  className: string | null;
  monthlyPrice: number | null; // 현재 설정의 EiE 월 수강료. 기존 확정 스냅샷과 구분한다.
  pricingMode: SessionPricingMode; // 확정 시점 단위. 설정·반 구분을 바꿔도 과거 계산은 불변.
  plannedSessions: number | null;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  confirmedAt: string | null;
  quantityBasis?: "days" | "attendance_units";
  allocatedAmount?: number | null;
  allocationStale?: boolean;
  allocationLineIndex?: number | null;
  invoiceHasAllocations?: boolean;
  refundState?: ReceiptRefundState;
  note: string | null;
  // 참고 표시용 — 그 **반**의 청구액(line_items에서 반 매칭, 학생 전체 아님). 매칭 실패 시 null("—").
  // N2: 자동 일치화 금지 — 확정값(회차×단가)이 진실, 이 값은 makeedu 대조 힌트일 뿐.
  classAmount: number | null;
};

export type SessionTermsView = {
  enrollmentHistory?: PlanHistory[];
  rows: SessionTermRow[];
  invoiceCount: number; // 그 달 청구서 수(계획 갱신 대상 규모)
  confirmedCount: number;
  catalog: SessionPrice[]; // 학원 설정의 공통 회당 단가. 월 금액은 섞지 않는다.
};

/** 청구월의 회차 확정 목록 + 회당 단가 프리셋. (B2: 전건은 fetchAllPaged / B3: .in은 청크 / B4: 병렬) */
export async function getSessionTermsView(period: string, invoiceId?: string): Promise<SessionTermsView> {
  const supabase = await createClient();

  const [invoices, settings] = await Promise.all([
    // ⚠️ 페이징에는 안정 정렬 필수 — 무순서 offset 페이징은 1000행 초과 시 중복/누락 위험(적대 리뷰 픽스).
    fetchAllPaged<{ id: string; student_id: string; line_items: unknown; status: string }>((from, to) => {
      // void(makeedu 삭제분) 제외 — 회차 계획·검증의 대상 청구서는 수납 화면과 같은 집합이어야 한다.
      const query = supabase.from("invoices").select("id, student_id, line_items, status").eq("period", period).neq("status", "void").order("id").range(from, to);
      return invoiceId ? query.eq("id", invoiceId) : query;
    }),
    getTenantSettings(),
  ]);
  const catalog = sessionPriceOptions(settings.billing.sessionPrices);
  if (invoices.length === 0)
    return { rows: [], invoiceCount: 0, confirmedCount: 0, catalog };

  const invoiceIds = invoices.map((i) => i.id);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const terms = await fetchInChunks<{
    id: string;
    invoice_id: string;
    subject: string;
    class_id: string | null;
    planned_sessions: number | null;
    confirmed_sessions: number | null;
    unit_price: number | null;
    pricing_mode: SessionPricingMode;
    amount: number | null;
    confirmed_at: string | null;
    quantity_basis: "days" | "attendance_units";
    allocation_line_index: number | null;
    allocation_amount: number | null;
    allocation_source: unknown;
    allocation_base_amount: number | null;
    note: string | null;
    class: { class_name?: string; english_track?: string | null } | { class_name?: string; english_track?: string | null }[] | null;
  }>(invoiceIds, (chunk) =>
    supabase
      .from("invoice_session_terms")
      .select(
        "id, invoice_id, subject, class_id, planned_sessions, confirmed_sessions, unit_price, pricing_mode, amount, confirmed_at, quantity_basis, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount, note, class:class_id ( class_name, english_track )",
      )
      .in("invoice_id", chunk),
  );

  const studentIds = [...new Set(invoices.map((i) => i.student_id))];
  const [students, live] = await Promise.all([fetchInChunks<{ id: string; name: string; grade: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade").in("id", chunk),
  ), loadLivePlans(supabase, period, studentIds, mergeHolidays(Number(period.slice(0, 4)), settings.operations.holidays.map((h) => h.date), true))]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const allocated = new Map<string, number>();
  const invoicesWithAllocations = new Set(terms.filter((term) => term.allocation_line_index != null).map((term) => term.invoice_id));
  for (const invoice of invoices) {
    const values = effectiveAllocations(receiptLines(invoice.line_items), terms.filter((term) => term.invoice_id === invoice.id).map((term) => ({
      id: term.id, amount: term.amount === null ? null : Number(term.amount), confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null, allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source, baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    for (const [id, amount] of values) allocated.set(id, amount);
  }

  const rows: SessionTermRow[] = terms
    .map<SessionTermRow | null>((t) => {
      const inv = invoiceById.get(t.invoice_id);
      if (!inv) return null;
      const stu = studentById.get(inv.student_id);
      const cls = Array.isArray(t.class) ? t.class[0] : t.class;
      const className = cls?.class_name ?? null;
      const lineItems = (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];
      const matching = lineItems.flatMap(receiptOriginalItems).filter((line) => receiptMatchesClass(line, { classId: t.class_id, className }));
      const states = matching.map(receiptRefundState);
      const fullyRefunded = inv.status === "refunded" || (states.length > 0 && states.every((s) => s === "full"));
      const refundReview = lineItems.some((line) => receiptRefundState(line) === "partial" || (receiptRefundState(line) === "mixed" && "receiptGroupId" in line));
      const refundState: ReceiptRefundState = fullyRefunded ? "full" : refundReview ? "partial" : states.some((s) => s !== "none") ? "mixed" : "none";
      return {
        id: t.id,
        invoiceId: t.invoice_id,
        studentId: inv.student_id,
        studentName: stu?.name ?? "—",
        studentGrade: stu?.grade ?? null,
        subject: t.subject,
        classId: t.class_id,
        className,
        monthlyPrice: isEieMonthlyClass(t.subject, cls?.english_track) ? settings.billing.eieMonthlyPrice : null,
        pricingMode: t.pricing_mode ?? "per_session",
        plannedSessions: t.class_id ? live.plans.get(inv.student_id)?.get(t.class_id) ?? 0 : t.planned_sessions === null ? null : Number(t.planned_sessions),
        confirmedSessions: t.confirmed_sessions === null ? null : Number(t.confirmed_sessions),
        unitPrice: t.unit_price === null ? null : Number(t.unit_price),
        amount: t.amount === null ? null : Number(t.amount),
        confirmedAt: t.confirmed_at,
        quantityBasis: t.quantity_basis ?? "days",
        refundState,
        allocatedAmount: fullyRefunded ? 0 : allocated.get(t.id) ?? null,
        allocationStale: !fullyRefunded && (refundState === "partial" || ((t.allocation_line_index != null || (invoicesWithAllocations.has(t.invoice_id) && t.confirmed_sessions !== null)) && !allocated.has(t.id))),
        allocationLineIndex: t.allocation_line_index ?? null,
        invoiceHasAllocations: invoicesWithAllocations.has(t.invoice_id),
        note: t.note,
        classAmount: fullyRefunded ? 0 : className ? classInvoiceAmount(className, lineItems) : null,
      } satisfies SessionTermRow;
    })
    .filter((r): r is SessionTermRow => r !== null)
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, "ko") ||
        a.subject.localeCompare(b.subject) ||
        (a.className ?? "").localeCompare(b.className ?? "", "ko"),
    );

  return {
    enrollmentHistory: live.history,
    rows,
    invoiceCount: invoices.length,
    confirmedCount: rows.filter((r) => r.confirmedSessions !== null).length,
    catalog,
  };
}
