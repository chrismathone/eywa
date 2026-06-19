import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TuitionCatalogRow, TuitionCatalogOption } from "@/features/billing/tuition-catalog";

// 수강료 단가표 DB 쿼리(server-only) — 과목 단가 + 기타 항목 + 할인 프리셋 통합 레지스트리(category로 구분).
// ijw 수강료 계산기 "설정"의 수강료 단가표를 eywa 한 테이블로 이식. textbook-catalog-queries 패턴 미러.
// 공유 상수·타입은 ../tuition-catalog.ts(클라이언트도 import 가능).
export type { TuitionCatalogRow, TuitionCatalogOption };
export { TUITION_CATEGORIES, DISCOUNT_CATEGORY } from "@/features/billing/tuition-catalog";

const PAGE_SIZE = 50;
const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function sanitize(q: string): string {
  return q.replace(/[%_,()]/g, " ").trim();
}

export async function getTuitionCatalogPage(
  opts: { q?: string; category?: string; active?: string } = {},
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<{ rows: TuitionCatalogRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("tuition_catalog")
    .select("id, category, name, price, note, is_active", { count: "exact" })
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  if (opts.active === "active") q = q.eq("is_active", true);
  else if (opts.active === "inactive") q = q.eq("is_active", false);
  if (opts.q) {
    const t = sanitize(opts.q);
    if (t) q = q.or(`name.ilike.%${t}%,category.ilike.%${t}%`);
  }

  const { data, count, error } = await q;
  if (error) throw new Error(`getTuitionCatalogPage: ${error.message}`);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      name: r.name,
      price: num(r.price),
      note: r.note,
      isActive: r.is_active,
    })),
    total: count ?? 0,
  };
}

/** 활성 단가표(계산기 picker). 보통 수십~수백 행이라 한 번에. */
export async function getTuitionCatalogActive(): Promise<TuitionCatalogOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tuition_catalog")
    .select("id, category, name, price, note")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`getTuitionCatalogActive: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    price: num(r.price),
    note: r.note,
  }));
}

export async function getTuitionCatalogStats(): Promise<{ total: number; active: number }> {
  const supabase = await createClient();
  const [{ count: total }, { count: active }] = await Promise.all([
    supabase.from("tuition_catalog").select("*", { count: "exact", head: true }),
    supabase.from("tuition_catalog").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);
  return { total: total ?? 0, active: active ?? 0 };
}
