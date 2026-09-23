import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { normalizePricingMode, PMODE_UNSET, tuitionCategoryOptions } from "@/features/billing/tuition-catalog";
import type { TuitionCatalogRow, TuitionCatalogOption } from "@/features/billing/tuition-catalog";

// 수강료 단가표 DB 쿼리(server-only) — 과목 단가 + 기타 항목 + 할인 프리셋 통합 레지스트리(category로 구분).
// ijw 수강료 계산기 "설정"의 수강료 단가표를 aywa 한 테이블로 이식. textbook-catalog-queries 패턴 미러.
// 공유 상수·타입은 ../tuition-catalog.ts(클라이언트도 import 가능).
export type { TuitionCatalogRow, TuitionCatalogOption };
export { DISCOUNT_CATEGORY } from "@/features/billing/tuition-catalog";

/**
 * 단가표 분류 선택지(감사 D7) — 학원설정 과목 라벨 ∪ 이미 쓰인 분류 ∪ '기타'·'할인'.
 * 이미 쓰인 분류는 distinct라 행 수와 무관하게 전건이 필요하다 → fetchAllPaged(B2, `.order("id")`).
 * 단가표는 학원당 수백 행 규모라 분류 한 칸만 읽는다.
 */
export async function getTuitionCategoryOptions(): Promise<string[]> {
  const supabase = await createClient();
  const [settings, rows] = await Promise.all([
    getTenantSettings(),
    fetchAllPaged<{ category: string | null }>((from, to) =>
      supabase.from("tuition_catalog").select("category").order("id").range(from, to),
    ),
  ]);
  return tuitionCategoryOptions(
    settings.operations.subjects.map((s) => s.label),
    rows.map((r) => r.category ?? ""),
  );
}

const PAGE_SIZE = 50;
const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function sanitize(q: string): string {
  return q.replace(/[%_,()]/g, " ").trim();
}

export async function getTuitionCatalogPage(
  opts: { q?: string; category?: string; active?: string; pmode?: string } = {},
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<{ rows: TuitionCatalogRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("tuition_catalog")
    .select("id, category, name, price, pricing_mode, note, is_active", { count: "exact" })
    // 🔴 **중지 항목을 맨 뒤로**(원장 2026-08-07: *"중지된것들은 전부 아래쪽으로 몰아서 보여"*).
    //    정렬을 서버에서 해야 페이지가 넘어가도 규칙이 유지된다 — 화면에서만 나누면 2페이지에 중지 항목이
    //    다시 섞여 나온다. 그 안에서는 종전대로 분류 → 이름 순.
    .order("is_active", { ascending: false })
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  // 🔴 `none` = **미지정만**. 이 갈래가 없으면 "아직 안 고른 항목"을 화면에서 골라낼 방법이 아예 없다
  //    (전체·회당·월·할인 어디에도 안 잡힌다). 남은 것을 세고 고르는 일이 이 화면의 실제 용무다.
  if (opts.pmode === PMODE_UNSET) q = q.is("pricing_mode", null);
  else if (opts.pmode && opts.pmode !== "all") q = q.eq("pricing_mode", opts.pmode);
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
      pricingMode: (r.pricing_mode ?? null) as TuitionCatalogRow["pricingMode"],
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
    .select("id, category, name, price, pricing_mode, note")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`getTuitionCatalogActive: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    price: num(r.price),
    pricingMode: normalizePricingMode(r.pricing_mode),
    note: r.note,
  }));
}

/**
 * 단가표 요약. `unset` = **사용 중인데 단가 종류가 안 정해진 항목 수**.
 *
 * 🔴 이 숫자가 화면에 있어야 하는 이유: 종류가 없으면 계산기가 안전한 쪽(월 고정)으로 넣는데,
 *    회당 수업이 그렇게 들어가면 한 달치가 한 회차 금액으로 줄어든다(반대로 월정액을 회당으로 바꾸면
 *    EiE 27만원 × N회). 남은 건수가 안 보이면 이 일은 영영 안 끝난다.
 * ⚠️ 세는 것만 한다 — `count: exact, head: true`라 행을 안 받는다(B2 규칙).
 */
export async function getTuitionCatalogStats(): Promise<{ total: number; active: number; unset: number }> {
  const supabase = await createClient();
  const [{ count: total }, { count: active }, { count: unset }] = await Promise.all([
    supabase.from("tuition_catalog").select("*", { count: "exact", head: true }),
    supabase.from("tuition_catalog").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("tuition_catalog")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .is("pricing_mode", null),
  ]);
  return { total: total ?? 0, active: active ?? 0, unset: unset ?? 0 };
}
