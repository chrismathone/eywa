import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { summarizeInvoices, currentPeriod, type BillingSummary } from "../calc";

// 순수 요약 로직은 calc.ts(서버 전용 아님 → Vitest)로 분리. 기존 importer 호환 위해 re-export(#Q2).
export { summarizeInvoices };
export type { BillingSummary };

export type InvoiceLineItem = {
  kind: string;
  description: string;
  classId?: string;
  amount: number;
};

export type InvoiceRow = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  period: string;
  category: string;
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  lineItems: InvoiceLineItem[];
  teacherName: string | null;
  // 결제 상세(0042a)
  paymentMethod: string | null;
  cardCompany: string | null;
  cashReceiptNumber: string | null;
  pointsUsed: number;
  discountReason: string | null;
  billedAt: string | null;
};

export type SortKey =
  | "status"
  | "name"
  | "amount_total"
  | "amount_paid"
  | "amount_discount"
  | "due_date";

export type InvoiceFilters = {
  period?: string;
  q?: string;
  sort?: SortKey;
  desc?: boolean;
  category?: string; // "all" | "tuition" | "material" | "exam" | "other"
};


export async function getInvoicesForPeriod(
  options?: InvoiceFilters,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const periodKey = options?.period ?? currentPeriod();
  let qb = supabase
    .from("invoices")
    .select(
      `id, period, category, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes, line_items,
       payment_method, card_company, cash_receipt_number, points_used, discount_reason, billed_at,
       student:student_id ( id, name, grade, teacher:primary_teacher_id ( display_name ) )`,
    )
    .eq("period", periodKey);

  if (options?.category && options.category !== "all") {
    qb = qb.eq("category", options.category);
  }

  const { data } = await qb;
  if (!data) return [];

  let rows: InvoiceRow[] = data.map((r) => {
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | {
          id: string;
          name: string;
          grade: string | null;
          teacher?: { display_name?: string } | { display_name?: string }[];
        }
      | undefined;
    const teacher = (Array.isArray(stu?.teacher) ? stu?.teacher[0] : stu?.teacher) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      studentId: stu?.id ?? "",
      studentName: stu?.name ?? "?",
      studentGrade: stu?.grade ?? null,
      period: r.period,
      category: (r as { category?: string }).category ?? "tuition",
      amountTotal: Number(r.amount_total),
      amountPaid: Number(r.amount_paid),
      amountDiscount: Number(r.amount_discount ?? 0),
      status: r.status,
      dueDate: r.due_date,
      paidAt: r.paid_at,
      notes: r.notes ?? null,
      lineItems: (r.line_items as InvoiceLineItem[]) ?? [],
      teacherName: teacher?.display_name ?? null,
      paymentMethod: (r as { payment_method?: string | null }).payment_method ?? null,
      cardCompany: (r as { card_company?: string | null }).card_company ?? null,
      cashReceiptNumber: (r as { cash_receipt_number?: string | null }).cash_receipt_number ?? null,
      pointsUsed: Number((r as { points_used?: number }).points_used ?? 0),
      discountReason: (r as { discount_reason?: string | null }).discount_reason ?? null,
      billedAt: (r as { billed_at?: string | null }).billed_at ?? null,
    };
  });

  // 검색
  if (options?.q) {
    const term = options.q.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) => {
        if (r.studentName.toLowerCase().includes(term)) return true;
        return r.lineItems.some((li) => li.description.toLowerCase().includes(term));
      });
    }
  }

  // 정렬
  const sort = options?.sort ?? "status";
  const desc = options?.desc ?? false;
  const dir = desc ? -1 : 1;
  rows.sort((a, b) => {
    switch (sort) {
      case "name":
        return a.studentName.localeCompare(b.studentName, "ko") * dir;
      case "amount_total":
        return (a.amountTotal - b.amountTotal) * dir;
      case "amount_paid":
        return (a.amountPaid - b.amountPaid) * dir;
      case "amount_discount":
        return (a.amountDiscount - b.amountDiscount) * dir;
      case "due_date":
        return ((a.dueDate ?? "").localeCompare(b.dueDate ?? "")) * dir;
      case "status":
      default: {
        const order = ["unpaid", "partial", "paid", "refunded", "void"];
        const ai = order.indexOf(a.status);
        const bi = order.indexOf(b.status);
        if (ai !== bi) return (ai - bi) * dir;
        return b.amountTotal - a.amountTotal;
      }
    }
  });

  return rows;
}

export async function getBillingSummary(period?: string): Promise<BillingSummary> {
  const rows = await getInvoicesForPeriod({ period });
  return summarizeInvoices(rows, period);
}

/** 가용 청구 월 목록 (descending) */
export async function getAvailablePeriods(): Promise<string[]> {
  const supabase = await createClient();
  // period 한 컬럼이라 전건이라도 가볍다. 단일 select면 invoices 1000행 초과 시 desc 정렬상 가장
  // 오래된 월이 silent 절단됨(데모 1606행 → 2026-03 칩 누락) → fetchAllPaged로 전건 distinct.
  const rows = await fetchAllPaged<{ period: string }>((from, to) =>
    supabase.from("invoices").select("period").order("period", { ascending: false }).range(from, to),
  );
  const set = new Set<string>();
  for (const r of rows) set.add(r.period);
  const arr = Array.from(set).sort((a, b) => b.localeCompare(a));
  // 현재 월이 비어 있어도 selector에는 노출
  const now = currentPeriod();
  if (!set.has(now)) arr.unshift(now);
  return arr;
}
