import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { DEFAULT_CURRENCY, roundMoney } from "../currencies";

// 지출관리(expenses) — 수납관리 창의 '지출' 책갈피 면. 월 단위(수납과 동일 톤). RLS가 tenant 강제.
// line_items는 두 가지 형태가 섞여 있다: ① aywa 폼이 쓴 {description,quantity,unitPrice,vat,total}
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

// 첨부 증빙 파일 — expense-receipts 버킷 경로 + 원본 파일명. 열람은 서버가 발급한 signed URL로만.
export type ExpenseReceipt = { path: string; name: string };

export type ExpenseRow = {
  id: string;
  title: string;
  category: string; // 인건비/운영비/매입/마케팅/기타
  amount: number;
  currency: string; // 통화 코드(KRW/USD/…) — 합계는 통화별 분리
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
  receiptType: string | null; // 증빙 유형(영수증/세금계산서 등)
  receiptUrls: ExpenseReceipt[]; // 첨부 파일 목록
  createdBy: string | null; // 작성자 user id(0112a) — 강사 "본인 것만" 스코프 소스. 사무실·임포트본은 null.
};

export type CurrencyTotal = { currency: string; total: number; count: number };
export type ExpenseSummary = {
  period: string;
  count: number;
  byCurrency: CurrencyTotal[]; // 통화별 총액(많은 건수 순) — 합계 분리 표기
  primaryCurrency: string; // 건수 최다 통화(분류별 바·최대분류는 이 통화 기준)
  byCategory: { category: string; amount: number; count: number }[]; // primaryCurrency 한정
  categoryCount: number;
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
  "id, title, category, amount, currency, expense_date, created_at, vendor, department, author, position, bank_name, account_number, approval_status, approval_checks, payment_method, memo, line_items, receipt_type, receipt_urls, created_by";

// receipt_urls jsonb → 정규화. 문자열 이중 인코딩 방어 + {path,name}만 보존.
function normalizeReceiptUrls(raw: unknown): ExpenseReceipt[] {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const path = typeof o.path === "string" ? o.path : "";
      const name = typeof o.name === "string" && o.name ? o.name : path.split("/").pop() || path;
      return { path, name };
    })
    .filter((r) => r.path);
}

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

// line_items raw(jsonb) → 정규화 배열. aywa(total/vat)·ijw(totalPrice/vatIncluded/purpose) 양쪽 흡수.
// ⚠️ ijw 임포트본은 JSON.stringify로 넣어 jsonb에 "문자열"로 이중 인코딩됨(배열 아님) → 문자열이면 1회 파싱.
function normalizeLineItems(raw: unknown, currency: string): ExpenseLineItem[] | null {
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
    // 저장된 total/totalPrice가 있으면 그대로, 없으면 통화 정밀도로 재계산($은 센트 반올림).
    const total =
      o.totalPrice != null
        ? Number(o.totalPrice)
        : o.total != null
          ? Number(o.total)
          : roundMoney(quantity * unitPrice * (vat ? 1.1 : 1), currency);
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
  const currency = typeof r.currency === "string" && r.currency ? r.currency : DEFAULT_CURRENCY;
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    amount: Number(r.amount),
    currency,
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
    lineItems: normalizeLineItems(r.line_items, currency),
    receiptType: r.receipt_type ?? null,
    receiptUrls: normalizeReceiptUrls(r.receipt_urls),
    createdBy: typeof r.created_by === "string" ? r.created_by : null,
  };
}

export async function getExpensesForMonth(period: string): Promise<ExpenseRow[]> {
  const supabase = await createClient();
  const { start, end } = monthRange(period);
  const data = await fetchAllPaged((from, to) => supabase
    .from("expenses")
    .select(EXPENSE_COLS)
    .gte("expense_date", start)
    .lt("expense_date", end)
    .order("expense_date", { ascending: false })
    .order("id")
    .range(from, to));
  return data.map(mapExpenseRow);
}

// 강사 '지출결의서' 면 — 본인이 작성(created_by=본인)한 결의서 전건(최신순). 강사 스코프의 단일 소스.
// tenant RLS로 테넌트 격리 + created_by eq로 본인 것만(사무실 결의서·타 강사 제출분은 안 보임). 최근 200건.
export async function getMyExpenseRequests(userId: string): Promise<ExpenseRow[]> {
  // 🔴 '다른 강사 뷰'면 userId = 대상 강사 X인데 DB의 auth.uid()는 실제 계정 A다 — A에게 지출 열람 권한이 없으면
  //    RLS(본인 작성분만)가 X의 결의서를 0건으로 돌려준다(원장 2026-11-05 강사뷰 전수). 이 조회는 이미 created_by = X로
  //    좁혀져 있으므로 강사뷰(대상 = 이 userId)일 때만 관리 클라이언트 + 지점 명시로 읽는다.
  const viewAs = await viewAsTeacher();
  const asTarget = viewAs !== null && viewAs.id === userId;
  const supabase = asTarget ? createAdminClient() : await createClient();
  let q = supabase.from("expenses").select(EXPENSE_COLS);
  if (asTarget) q = q.eq("tenant_id", viewAs.tenantId);
  const { data, error } = await q
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(200);
  // 감사 E6 — 조회 실패를 빈 목록으로 삼키면 "결의서 0건"이라는 거짓 화면이 된다. 한글 요약으로 알린다.
  if (error) throw new Error("지출결의서 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요");
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
  // 1) 통화별 총액(₩와 $를 한 숫자로 더하지 않는다 — 사용자 요구 핵심).
  const byCur = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const c = byCur.get(r.currency) ?? { total: 0, count: 0 };
    c.total += r.amount;
    c.count += 1;
    byCur.set(r.currency, c);
  }
  const byCurrency = [...byCur.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    // 코드 알파벳을 3차 키로 — count·total 동률 시 primaryCurrency가 DB 순서에 흔들리지 않게 결정적 정렬.
    .sort((a, b) => b.count - a.count || b.total - a.total || a.currency.localeCompare(b.currency));
  const primaryCurrency = byCurrency[0]?.currency ?? DEFAULT_CURRENCY;

  // 2) 분류별 지출은 단일 통화(바 길이가 의미 있으려면 동일 통화여야) → 주 통화 한정 집계.
  const byCat = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    if (r.currency !== primaryCurrency) continue;
    const c = byCat.get(r.category) ?? { amount: 0, count: 0 };
    c.amount += r.amount;
    c.count += 1;
    byCat.set(r.category, c);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);

  return { period, count: rows.length, byCurrency, primaryCurrency, byCategory, categoryCount: byCategory.length };
}

// 지출이 존재하는 월 목록(YYYY-MM, 최신순) — 월 칩용.
export async function getExpenseMonths(): Promise<string[]> {
  const supabase = await createClient();
  // B2: distinct를 JS Set으로 만드는 전건 조회는 무페이징이면 1000행에서 silent 절단된다
  // (invoices의 getAvailablePeriods가 정확히 이 코드로 2026-03 월 칩을 잃었던 사고와 같은 구조).
  // `data ?? []`의 error 삼킴도 함께 해소 — fetchAllPaged는 실패를 throw한다. 현재 169행이라 잠복 상태.
  const rows = await fetchAllPaged<{ expense_date: string | null }>((from, to) =>
    supabase.from("expenses").select("expense_date").order("id", { ascending: true }).range(from, to),
  );
  const set = new Set<string>();
  for (const r of rows) {
    const d = r.expense_date;
    if (d) set.add(d.slice(0, 7));
  }
  return [...set].sort().reverse();
}
