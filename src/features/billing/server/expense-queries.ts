import "server-only";
import { createClient } from "@/lib/supabase/server";

// 지출관리(expenses) — 수납관리 창의 '지출' 책갈피 면. 월 단위(수납과 동일 톤). RLS가 tenant 강제.
export type ExpenseLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  vat: boolean;
  total: number;
};

export type ExpenseRow = {
  id: string;
  title: string;
  category: string; // 인건비/운영비/매입/마케팅/기타
  amount: number;
  expenseDate: string;
  vendor: string | null;
  department: string | null;
  author: string | null;
  approvalStatus: string;
  paymentMethod: string | null;
  memo: string | null;
  lineItems: ExpenseLineItem[] | null;
};

export type ExpenseSummary = {
  period: string;
  count: number;
  total: number;
  byCategory: { category: string; amount: number; count: number }[];
};

// "YYYY-MM" → [start, endExclusive) 날짜 (Date 미사용 — RSC 순수성).
function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

export async function getExpensesForMonth(period: string): Promise<ExpenseRow[]> {
  const supabase = await createClient();
  const { start, end } = monthRange(period);
  const { data } = await supabase
    .from("expenses")
    .select(
      "id, title, category, amount, expense_date, vendor, department, author, approval_status, payment_method, memo, line_items",
    )
    .gte("expense_date", start)
    .lt("expense_date", end)
    .order("expense_date", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    amount: Number(r.amount),
    expenseDate: r.expense_date,
    vendor: r.vendor,
    department: r.department,
    author: r.author,
    approvalStatus: r.approval_status,
    paymentMethod: r.payment_method,
    memo: r.memo,
    lineItems: Array.isArray(r.line_items) ? (r.line_items as ExpenseLineItem[]) : null,
  }));
}

export function summarizeExpenses(rows: ExpenseRow[], period: string): ExpenseSummary {
  const byCat = new Map<string, { amount: number; count: number }>();
  let total = 0;
  for (const r of rows) {
    total += r.amount;
    const c = byCat.get(r.category) ?? { amount: 0, count: 0 };
    c.amount += r.amount;
    c.count += 1;
    byCat.set(r.category, c);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);
  return { period, count: rows.length, total, byCategory };
}

// 지출이 존재하는 월 목록(YYYY-MM, 최신순) — 월 칩용.
export async function getExpenseMonths(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("expenses").select("expense_date");
  const set = new Set<string>();
  for (const r of data ?? []) {
    const d = r.expense_date as string | null;
    if (d) set.add(d.slice(0, 7));
  }
  return [...set].sort().reverse();
}
