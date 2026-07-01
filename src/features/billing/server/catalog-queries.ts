import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CatalogRow = {
  id: string;
  title: string;
  bookDetail: string | null;
  gradeLevel: string | null;
  subject: string | null;
  publisher: string | null;
  price: number;
  isActive: boolean;
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
};

// textbook-dialog 교재검색 picker용 경량 옵션
export type CatalogOption = {
  id: string;
  title: string;
  bookDetail: string | null;
  price: number;
};

const PAGE_SIZE = 50;
const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function sanitize(q: string): string {
  return q.replace(/[%_,()]/g, " ").trim();
}

export async function getCatalogPage(
  opts: { q?: string; gradeLevel?: string; active?: string } = {},
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<{ rows: CatalogRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("textbook_catalog")
    .select("id, title, book_detail, grade_level, subject, publisher, price, is_active, sync_added_at", {
      count: "exact",
    })
    .order("title", { ascending: true })
    .range(from, from + pageSize - 1);

  if (opts.gradeLevel && opts.gradeLevel !== "all") q = q.eq("grade_level", opts.gradeLevel);
  if (opts.active === "active") q = q.eq("is_active", true);
  else if (opts.active === "inactive") q = q.eq("is_active", false);
  if (opts.q) {
    const t = sanitize(opts.q);
    if (t) q = q.or(`title.ilike.%${t}%,publisher.ilike.%${t}%`);
  }

  const { data, count, error } = await q;
  if (error) throw new Error(`getCatalogPage: ${error.message}`);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      bookDetail: r.book_detail,
      gradeLevel: r.grade_level,
      subject: r.subject,
      publisher: r.publisher,
      price: num(r.price),
      isActive: r.is_active,
      syncAddedAt: (r as { sync_added_at?: string | null }).sync_added_at ?? null,
    })),
    total: count ?? 0,
  };
}

/** 활성 카탈로그(교재검색 picker). 단가표는 보통 수십~수백 행이라 한 번에. */
export async function getCatalogOptions(): Promise<CatalogOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("textbook_catalog")
    .select("id, title, book_detail, price")
    .eq("is_active", true)
    .order("title", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    bookDetail: r.book_detail,
    price: num(r.price),
  }));
}

export async function getCatalogStats(): Promise<{ total: number; active: number }> {
  const supabase = await createClient();
  const [{ count: total }, { count: active }] = await Promise.all([
    supabase.from("textbook_catalog").select("*", { count: "exact", head: true }),
    supabase.from("textbook_catalog").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);
  return { total: total ?? 0, active: active ?? 0 };
}
