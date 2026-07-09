import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";

// 수강료 견적(tuition_quotes) 조회 — 신입생 상담 견적 저장소(invoices와 분리).

export type QuoteListItem = {
  id: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  consultant: string | null;
  courseCount: number;
  extraCount: number;
  totalAmount: number;
  createdAt: string;
};

export type QuoteDetail = {
  id: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  consultant: string | null;
  startDate: string | null;
  endDate: string | null;
  courses: QuoteCourse[];
  extras: QuoteExtra[];
  discounts: QuoteDiscount[];
  totalAmount: number;
  createdAt: string;
};

const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

// jsonb는 배열로 저장되지만, 혹시 문자열로 이중인코딩된 경우(임포트 등) 1회 parse해 흡수.
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sanitize(q: string): string {
  return q.replace(/[%_,()]/g, " ").trim();
}

const PAGE_SIZE = 50;

export async function getQuotesPage(
  opts: { q?: string } = {},
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<{ rows: QuoteListItem[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("tuition_quotes")
    .select("id, student_name, school, grade, consultant, courses, extras, total_amount, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (opts.q) {
    const t = sanitize(opts.q);
    if (t) q = q.or(`student_name.ilike.%${t}%,school.ilike.%${t}%`);
  }

  const { data, count, error } = await q;
  if (error) throw new Error(`getQuotesPage: ${error.message}`);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      studentName: r.student_name,
      school: r.school,
      grade: r.grade,
      consultant: r.consultant,
      courseCount: asArray(r.courses).length,
      extraCount: asArray(r.extras).length,
      totalAmount: num(r.total_amount),
      createdAt: r.created_at,
    })),
    total: count ?? 0,
  };
}

export async function getQuoteById(id: string): Promise<QuoteDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tuition_quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getQuoteById: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    studentName: data.student_name,
    school: data.school,
    grade: data.grade,
    consultant: data.consultant,
    startDate: data.start_date,
    endDate: data.end_date,
    courses: asArray<QuoteCourse>(data.courses),
    extras: asArray<QuoteExtra>(data.extras),
    discounts: asArray<QuoteDiscount>(data.discounts),
    totalAmount: num(data.total_amount),
    createdAt: data.created_at,
  };
}

export async function getQuoteCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("tuition_quotes")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}
