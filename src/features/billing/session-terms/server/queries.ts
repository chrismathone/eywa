import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { classInvoiceAmount, type LineItemLike } from "../class-amount";

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
  plannedSessions: number | null;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  confirmedAt: string | null;
  note: string | null;
  // 참고 표시용 — 그 **반**의 청구액(line_items에서 반 매칭, 학생 전체 아님). 매칭 실패 시 null("—").
  // N2: 자동 일치화 금지 — 확정값(회차×단가)이 진실, 이 값은 makeedu 대조 힌트일 뿐.
  classAmount: number | null;
};

export type SessionTermsView = {
  rows: SessionTermRow[];
  invoiceCount: number; // 그 달 청구서 수(계획 갱신 대상 규모)
  confirmedCount: number;
  catalog: { id: string; name: string; price: number }[]; // 회당 단가 프리셋(per_session만, N5)
};

/** 청구월의 회차 확정 목록 + 회당 단가 프리셋. (B2: 전건은 fetchAllPaged / B3: .in은 청크 / B4: 병렬) */
export async function getSessionTermsView(period: string): Promise<SessionTermsView> {
  const supabase = await createClient();

  const [invoices, catalog] = await Promise.all([
    fetchAllPaged<{ id: string; student_id: string; line_items: unknown }>((from, to) =>
      supabase.from("invoices").select("id, student_id, line_items").eq("period", period).range(from, to),
    ),
    supabase
      .from("tuition_catalog")
      .select("id, name, price")
      .eq("pricing_mode", "per_session")
      .eq("is_active", true)
      .order("name"),
  ]);
  if (invoices.length === 0)
    return { rows: [], invoiceCount: 0, confirmedCount: 0, catalog: catalogRows(catalog.data) };

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
    amount: number | null;
    confirmed_at: string | null;
    note: string | null;
    class: { class_name?: string } | { class_name?: string }[] | null;
  }>(invoiceIds, (chunk) =>
    supabase
      .from("invoice_session_terms")
      .select(
        "id, invoice_id, subject, class_id, planned_sessions, confirmed_sessions, unit_price, amount, confirmed_at, note, class:class_id ( class_name )",
      )
      .in("invoice_id", chunk),
  );

  const studentIds = [...new Set(invoices.map((i) => i.student_id))];
  const students = await fetchInChunks<{ id: string; name: string; grade: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade").in("id", chunk),
  );
  const studentById = new Map(students.map((s) => [s.id, s]));

  const rows: SessionTermRow[] = terms
    .map((t) => {
      const inv = invoiceById.get(t.invoice_id);
      if (!inv) return null;
      const stu = studentById.get(inv.student_id);
      const cls = (Array.isArray(t.class) ? t.class[0] : t.class) as { class_name?: string } | undefined;
      const className = cls?.class_name ?? null;
      const lineItems = (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];
      return {
        id: t.id,
        invoiceId: t.invoice_id,
        studentId: inv.student_id,
        studentName: stu?.name ?? "—",
        studentGrade: stu?.grade ?? null,
        subject: t.subject,
        classId: t.class_id,
        className,
        plannedSessions: t.planned_sessions,
        confirmedSessions: t.confirmed_sessions,
        unitPrice: t.unit_price === null ? null : Number(t.unit_price),
        amount: t.amount === null ? null : Number(t.amount),
        confirmedAt: t.confirmed_at,
        note: t.note,
        classAmount: className ? classInvoiceAmount(className, lineItems) : null,
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
    rows,
    invoiceCount: invoices.length,
    confirmedCount: rows.filter((r) => r.confirmedSessions !== null).length,
    catalog: catalogRows(catalog.data),
  };
}

function catalogRows(data: { id: string; name: string; price: unknown }[] | null) {
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, price: Number(c.price) || 0 }));
}
