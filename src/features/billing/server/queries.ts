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
  amountTotal: number;
  amountPaid: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  lineItems: InvoiceLineItem[];
};

export type BillingSummary = {
  period: string;
  totalCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  totalBilled: number;
  totalCollected: number;
  outstanding: number;
  paymentRate: number;
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getInvoicesForPeriod(period?: string): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const periodKey = period ?? currentPeriod();
  const { data } = await supabase
    .from("invoices")
    .select(
      `id, period, amount_total, amount_paid, status, due_date, paid_at, line_items,
       student:student_id ( id, name, grade )`,
    )
    .eq("period", periodKey)
    .order("status")
    .order("amount_total", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string; grade: string | null }
      | undefined;
    return {
      id: r.id,
      studentId: stu?.id ?? "",
      studentName: stu?.name ?? "?",
      studentGrade: stu?.grade ?? null,
      period: r.period,
      amountTotal: Number(r.amount_total),
      amountPaid: Number(r.amount_paid),
      status: r.status,
      dueDate: r.due_date,
      paidAt: r.paid_at,
      lineItems: (r.line_items as InvoiceLineItem[]) ?? [],
    };
  });
}

export async function getBillingSummary(period?: string): Promise<BillingSummary> {
  const rows = await getInvoicesForPeriod(period);
  const totalCount = rows.length;
  const paidCount = rows.filter((r) => r.status === "paid").length;
  const partialCount = rows.filter((r) => r.status === "partial").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid").length;
  const totalBilled = rows.reduce((s, r) => s + r.amountTotal, 0);
  const totalCollected = rows.reduce((s, r) => s + r.amountPaid, 0);
  return {
    period: period ?? currentPeriod(),
    totalCount,
    paidCount,
    partialCount,
    unpaidCount,
    totalBilled,
    totalCollected,
    outstanding: totalBilled - totalCollected,
    paymentRate: totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0,
  };
}
