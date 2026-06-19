import "server-only";
import { createClient } from "@/lib/supabase/server";

// 지출관리(expenses) — 수납관리 창의 '지출' 책갈피 면. 월 단위(수납과 동일 톤). RLS가 tenant 강제.
// line_items는 두 가지 형태가 섞여 있다: ① eywa 폼이 쓴 {description,quantity,unitPrice,vat,total}
// ② ijw 임포트본이 보존한 {purpose,vendor,description,quantity,unitPrice,totalPrice,vatIncluded}.
// normalizeLineItems가 둘을 아래 단일 형태로 흡수한다(지출결의서 상세가 용도/거래처까지 쓰므로).
export type ExpenseLineItem = {
  purpose: string | null; // 용도 (ijw)
  vendor: string | null; // 거래처 (ijw — 라인별)
  description: string; // 사용내역
  quantity: number;
  unitPrice: number;
  vat: boolean;
  total: number;
};

// 결재 단계(작성/원장/대표/집행자) — ijw approvalChecks 패리티. jsonb로 보관.
export type ApprovalStage = { checked: boolean; date?: string | null };
export type ApprovalRole = "author" | "director" | "ceo" | "executor";
export type ApprovalChecks = Partial<Record<ApprovalRole, ApprovalStage>>;
export const APPROVAL_ROLES: ApprovalRole[] = ["author", "director", "ceo", "executor"];

export type ExpenseRow = {
  id: string;
  title: string;
  category: string; // 인건비/운영비/매입/마케팅/기타
  amount: number;
  expenseDate: string;
  createdDate: string | null; // 작성일자(created_at의 날짜부) — 지출결의서 머리표
  vendor: string | null;
  department: string | null;
  author: string | null;
  position: string | null; // 직위
  bankName: string | null; // 은행명/카드명
  accountNumber: string | null; // 계좌번호/카드번호
  approvalStatus: string;
  approvalChecks: ApprovalChecks;
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

const EXPENSE_COLS =
  "id, title, category, amount, expense_date, created_at, vendor, department, author, position, bank_name, account_number, approval_status, approval_checks, payment_method, memo, line_items";

// approval_checks jsonb → 정규화. 문자열로 들어와도(이중 인코딩 방지) 1회 파싱 + 유효 역할만 보존.
// 액션(toggleExpenseApproval)도 merge 전에 이걸 거쳐 문자열·잡키 오염을 막는다.
export function normalizeApprovalChecks(raw: unknown): ApprovalChecks {
  let obj: unknown = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const src = obj as Record<string, unknown>;
  const out: ApprovalChecks = {};
  for (const role of APPROVAL_ROLES) {
    const s = src[role];
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      out[role] = { checked: o.checked === true, date: typeof o.date === "string" ? o.date : null };
    }
  }
  return out;
}

// line_items raw(jsonb) → 정규화 배열. eywa(total/vat)·ijw(totalPrice/vatIncluded/purpose) 양쪽 흡수.
// ⚠️ ijw 임포트본은 JSON.stringify로 넣어 jsonb에 "문자열"로 이중 인코딩됨(배열 아님) → 문자열이면 1회 파싱.
function normalizeLineItems(raw: unknown): ExpenseLineItem[] | null {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const quantity = Number(o.quantity) || 0;
    const unitPrice = Number(o.unitPrice) || 0;
    const vat =
      typeof o.vatIncluded === "boolean"
        ? o.vatIncluded
        : typeof o.vat === "boolean"
          ? o.vat
          : false;
    const total =
      o.totalPrice != null
        ? Number(o.totalPrice)
        : o.total != null
          ? Number(o.total)
          : Math.round(quantity * unitPrice * (vat ? 1.1 : 1));
    return {
      purpose: typeof o.purpose === "string" && o.purpose.trim() ? o.purpose : null,
      vendor: typeof o.vendor === "string" && o.vendor.trim() ? o.vendor : null,
      description: typeof o.description === "string" ? o.description : "",
      quantity,
      unitPrice,
      vat,
      total,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase row는 string-typed
function mapExpenseRow(r: any): ExpenseRow {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    amount: Number(r.amount),
    expenseDate: r.expense_date,
    createdDate: typeof r.created_at === "string" ? r.created_at.slice(0, 10) : null,
    vendor: r.vendor,
    department: r.department,
    author: r.author,
    position: r.position ?? null,
    bankName: r.bank_name ?? null,
    accountNumber: r.account_number ?? null,
    approvalStatus: r.approval_status,
    approvalChecks: normalizeApprovalChecks(r.approval_checks),
    paymentMethod: r.payment_method,
    memo: r.memo,
    lineItems: normalizeLineItems(r.line_items),
  };
}

export async function getExpensesForMonth(period: string): Promise<ExpenseRow[]> {
  const supabase = await createClient();
  const { start, end } = monthRange(period);
  const { data } = await supabase
    .from("expenses")
    .select(EXPENSE_COLS)
    .gte("expense_date", start)
    .lt("expense_date", end)
    .order("expense_date", { ascending: false });
  return (data ?? []).map(mapExpenseRow);
}

// 단건 — 지출결의서 상세(창). RLS가 tenant 격리하므로 id만으로 조회. 없으면 null(→ notFound).
export async function getExpenseById(id: string): Promise<ExpenseRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select(EXPENSE_COLS)
    .eq("id", id)
    .maybeSingle();
  return data ? mapExpenseRow(data) : null;
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
