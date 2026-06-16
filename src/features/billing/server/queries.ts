import "server-only";
import { createClient } from "@/lib/supabase/server";

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
};

export type BillingSummary = {
  period: string;
  totalCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  totalBilled: number;
  totalCollected: number;
  totalDiscount: number;
  outstanding: number;
  paymentRate: number;
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

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getInvoicesForPeriod(
  options?: InvoiceFilters,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const periodKey = options?.period ?? currentPeriod();
  let qb = supabase
    .from("invoices")
    .select(
      `id, period, category, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes, line_items,
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

/**
 * 청구서 배열 → 요약 KPI (순수 함수, 네트워크 0).
 * 페이지가 월 전체를 한 번만 fetch한 뒤 이 함수로 요약을 도출해 이중 fetch를 없앤다.
 */
export function summarizeInvoices(rows: InvoiceRow[], period?: string): BillingSummary {
  const totalBilled = rows.reduce((s, r) => s + r.amountTotal, 0);
  const totalCollected = rows.reduce((s, r) => s + r.amountPaid, 0);
  return {
    period: period ?? currentPeriod(),
    totalCount: rows.length,
    paidCount: rows.filter((r) => r.status === "paid").length,
    partialCount: rows.filter((r) => r.status === "partial").length,
    unpaidCount: rows.filter((r) => r.status === "unpaid").length,
    totalBilled,
    totalCollected,
    totalDiscount: rows.reduce((s, r) => s + r.amountDiscount, 0),
    outstanding: totalBilled - totalCollected,
    paymentRate: totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0,
  };
}

export async function getBillingSummary(period?: string): Promise<BillingSummary> {
  const rows = await getInvoicesForPeriod({ period });
  return summarizeInvoices(rows, period);
}

/** 가용 청구 월 목록 (descending) */
export async function getAvailablePeriods(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("period")
    .order("period", { ascending: false });
  const set = new Set<string>();
  for (const r of data ?? []) set.add(r.period);
  const arr = Array.from(set).sort((a, b) => b.localeCompare(a));
  // 현재 월이 비어 있어도 selector에는 노출
  const now = currentPeriod();
  if (!set.has(now)) arr.unshift(now);
  return arr;
}
