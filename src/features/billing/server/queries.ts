import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { summarizeInvoices, currentPeriod, type BillingSummary } from "../calc";

// 순수 요약 로직은 calc.ts(서버 전용 아님 → Vitest)로 분리. 기존 importer 호환 위해 re-export(#Q2).
export { summarizeInvoices };
export type { BillingSummary };

export type InvoiceLineItem = {
  kind: string; // 구분: 수업/교재/차량비/기타
  description: string; // 수납명
  classId?: string;
  amount: number; // 청구액
  // 라인 단위 수납 표(makeedu 동일)용 항목별 상세(임포터 보강, 2026-07-08). 구데이터는 없을 수 있어 optional.
  discount?: number; // 할인액
  points?: number; // 적립금
  paid?: number; // 실제낸금액
  unpaid?: number; // 미납금액
  method?: string | null; // 결제수단
  paidDate?: string | null; // 수납일
  receipt?: string | null; // 현금영수증
  dueDay?: number | null; // 청구일
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
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
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

// line_items jsonb는 소스마다 형태가 다르다: 구 makeedu 동기화는 {name,amount}(description 없음),
// eywa 폼/POC는 {kind,description,amount}, 2026-07-08 재적재 이후는 항목별 상세 11-key. description을
// 단일 소스로 정규화(name→description)해 검색 필터가 `undefined.toLowerCase()`로 터지지 않게 하고,
// ⚠️ 항목별 상세(할인/실납/미납/결제 등)는 **있으면 통과**시킨다 — 미지 키 무언 드랍은 라인 단위 표를
// 조용히 비우는 write-only-orphan(2026-07-13 머지 검증에서 실측한 사고 — 타입만 확장되고 여기서 잘렸음).
function normalizeInvoiceLineItems(raw: unknown): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const description =
      typeof o.description === "string" && o.description
        ? o.description
        : typeof o.name === "string"
          ? o.name
          : "";
    const opt = {
      classId: str(o.classId),
      discount: num(o.discount),
      points: num(o.points),
      paid: num(o.paid),
      unpaid: num(o.unpaid),
      method: str(o.method),
      paidDate: str(o.paidDate),
      receipt: str(o.receipt),
      dueDay: num(o.dueDay),
    };
    return {
      kind: typeof o.kind === "string" ? o.kind : "tuition",
      description,
      amount: Number(o.amount) || 0,
      // undefined 필드는 키 자체를 생략(구데이터 optional 계약 유지)
      ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v !== undefined)),
    };
  });
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
       payment_method, card_company, cash_receipt_number, points_used, discount_reason, billed_at, sync_added_at,
       student:student_id ( id, name, grade, teacher:primary_teacher_id ( display_name ) )`,
    )
    .eq("period", periodKey)
    // void = makeedu에서 삭제된 청구(동기화가 무효 처리) — 수납 표·KPI·엑셀은 makeedu 미러라 제외.
    // 행 자체는 DB에 보존(notes [동기화] 마커 = 근거), 학생 상세 수납 이력에는 '무효' 배지로 남는다.
    .neq("status", "void");

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
      lineItems: normalizeInvoiceLineItems(r.line_items),
      teacherName: teacher?.display_name ?? null,
      paymentMethod: (r as { payment_method?: string | null }).payment_method ?? null,
      cardCompany: (r as { card_company?: string | null }).card_company ?? null,
      cashReceiptNumber: (r as { cash_receipt_number?: string | null }).cash_receipt_number ?? null,
      pointsUsed: Number((r as { points_used?: number }).points_used ?? 0),
      discountReason: (r as { discount_reason?: string | null }).discount_reason ?? null,
      billedAt: (r as { billed_at?: string | null }).billed_at ?? null,
      syncAddedAt: (r as { sync_added_at?: string | null }).sync_added_at ?? null,
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
