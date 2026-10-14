import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineItemLike } from "@/features/billing/session-terms/class-amount";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { shiftMonth } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { soleLeftover, type RevenueInvoice, type SolePair } from "../model/pay-revenue";

type InvoiceRow = { id: string; student_id: string; line_items: unknown; status: string | null };
type TermRow = { id: string; invoice_id: string; class_id: string | null; allocation_line_index: number | null; allocation_amount: number | string | null };
type EnrollmentRow = { id: string; student_id: string; class_id: string; start_date: string; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type ClassRow = { id: string; class_name: string | null };
/** `enrolled` = 학생별 그 달 실제로 다닌 반(휴원 포함 · 반 이동은 반열림) — 이게 없는 출석부 줄은 보강 방문이다. */
export type MonthRevenue = { invoices: Map<string, RevenueInvoice[]>; sole: Map<string, SolePair>; enrolled: Map<string, Set<string>> };

/**
 * 그 달 청구서 → 학생별 [항목 · 회차 행이 있는 반 · 배분 · 자유 배분 여부] + 짝이 하나뿐인 항목(`soleLeftover`) — '매출 대비 급여'의
 * 매출 재료(`rowRevenue`). 범위는 출석부 청구액과 같다(그 달 · 지점 · 취소 아닌 것 — 상태 없음은 살아 있음 · 회차 행도 살아 있는 청구서 것만).
 * 짝을 지으려면 그 학생의 반 전부가 필요해 수강도 읽는다 — 선생님 출석부 하나로는 다른 선생님 반을 모른다. 항목 주인을 가리려고
 *   앞뒤 달 수강까지 읽고(지난 반·다음 달 반 몫 항목), 짝을 받을 반은 그 달 실제로 다닌 반만(휴원 제외 · 반 이동은 반열림 #125).
 * 관리 클라이언트라 지점 조건을 여기서 건다(#104). 모두 1,000행을 넘을 수 있어 페이징(B2·B3).
 * ⚠️ 배분은 '회차 행에 적힌 것'으로만 본다 — 출석부는 그 배분이 아직 유효한지까지 보지만(`effectiveAllocations`), 그 판정 재료가 크다.
 *    무효가 된 배분이 걸린 줄은 출석부 청구액이 비고 여기서도 짝 후보에서 빠져 '못 맞춘 줄'로 남는다(매출을 지어내지 않는 쪽).
 */
export async function loadMonthRevenue(admin: SupabaseClient, tenantId: string, month: string): Promise<MonthRevenue> {
  const start = `${month}-01`, next = `${shiftMonth(month, 1)}-01`;
  const [rows, enrollments, classes] = await Promise.all([
    fetchAllPaged<InvoiceRow>((a, b) =>
      admin.from("invoices").select("id, student_id, line_items, status").eq("tenant_id", tenantId).eq("period", month).order("id").range(a, b)),
    fetchAllPaged<EnrollmentRow>((a, b) =>
      admin.from("enrollments").select("id, student_id, class_id, start_date, end_date, on_hold, is_transferred").eq("tenant_id", tenantId)
        .lt("start_date", `${shiftMonth(month, 2)}-01`).or(`end_date.is.null,end_date.gte.${shiftMonth(month, -1)}-01`).order("id").range(a, b)),
    fetchAllPaged<ClassRow>((a, b) => admin.from("classes").select("id, class_name").eq("tenant_id", tenantId).order("id").range(a, b)),
  ]);
  const live = rows.filter((r) => r.status !== "void");
  const terms = await fetchAllPagedInChunks<TermRow>(live.map((r) => r.id), (chunk, a, b) =>
    admin.from("invoice_session_terms").select("id, invoice_id, class_id, allocation_line_index, allocation_amount")
      .eq("tenant_id", tenantId).in("invoice_id", chunk).order("id").range(a, b));
  const termsOf = new Map<string, TermRow[]>();
  for (const t of terms) termsOf.set(t.invoice_id, [...(termsOf.get(t.invoice_id) ?? []), t]);
  const invoices = new Map<string, RevenueInvoice[]>();
  for (const r of live) {
    const own = termsOf.get(r.id) ?? [];
    const allocated = own.filter((t) => t.allocation_line_index != null || t.allocation_amount != null);
    invoices.set(r.student_id, [...(invoices.get(r.student_id) ?? []), {
      items: (Array.isArray(r.line_items) ? r.line_items : []) as LineItemLike[],
      termClassIds: new Set(own.flatMap((t) => (t.class_id ? [t.class_id] : []))),
      freeAllocated: own.some((t) => t.allocation_line_index == null && Number(t.allocation_amount ?? 0) > 0),
      allocatedClassIds: new Set(allocated.flatMap((t) => (t.class_id ? [t.class_id] : []))),
      allocatedLines: new Set(allocated.flatMap((t) => (t.allocation_line_index != null ? [t.allocation_line_index] : []))),
    }]);
  }
  const nameOf = new Map(classes.map((c) => [c.id, c.class_name ?? ""]));
  const classesOf = new Map<string, { id: string; name: string; open: boolean }[]>();
  const enrolled = new Map<string, Set<string>>();
  for (const e of enrollments) {
    if (!invoices.has(e.student_id)) continue;
    const inMonth = e.start_date < next && !isEnrollmentEndedOn(e.end_date, start, Boolean(e.is_transferred));
    if (inMonth) enrolled.set(e.student_id, (enrolled.get(e.student_id) ?? new Set()).add(e.class_id));
    classesOf.set(e.student_id, [...(classesOf.get(e.student_id) ?? []),
      { id: e.class_id, name: nameOf.get(e.class_id) ?? "", open: inMonth && !e.on_hold }]);
  }
  const sole = new Map<string, SolePair>();
  for (const [studentId, own] of classesOf) {
    const pair = soleLeftover(own, invoices.get(studentId) ?? []);
    if (pair) sole.set(studentId, pair);
  }
  return { invoices, sole, enrolled };
}
