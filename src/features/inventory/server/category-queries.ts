import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { reportError } from "@/lib/observability/report-error";
import { BUILTIN_CATEGORIES, type InventoryCategory } from "../category";
import { isMissingInventoryTable } from "./access";
import type { TableStatus } from "./queries";

/**
 * 자산 분류 조회(0247a `inventory_categories`) — 화면·서버 액션이 함께 쓰는 단일 소스.
 *
 * ⚠️ 0247a 미적용 배포에서도 죽지 않는다([[#95]]) — 표가 없으면 **내장 7종으로 폴백**해 화면·자산 등록은
 *    그대로 돌고, `ready:false`가 **새 분류 자동 추가만** 잠근다(dedup 못 하는 자동 쓰기보다 잠그는 게 낫다).
 * 🔴 원인을 단정하지 않는다: 표 없음(42P01·PGRST205)과 그냥 실패는 다른 사실이고 배너 문구도 다르다.
 * ⚠️ 분류는 100건 미만의 작은 목록이라 페이징 없이 받되 `.limit()`으로 상한을 못박는다(B2 — 무페이징
 *    bare select 금지 규약의 취지는 "조용한 절단 금지"이고, 명시 상한은 그 절단을 드러낸다).
 */
export const CATEGORY_LIMIT = 200;

export type CategoryData = {
  status: TableStatus;
  rows: InventoryCategory[];
  /** 이 목록으로 **분류를 새로 만들어도 되는가** — 표가 실제로 있고 시드가 돼 있을 때만 true. */
  ready: boolean;
  /** 내장 7종 폴백으로 그리고 있는가(표 없음·조회 실패·시드 0건). */
  fallback: boolean;
};

type Row = { key: string; label: string; code_prefix: string; sort_order: number };

function toCategories(rows: Row[]): InventoryCategory[] {
  return rows.map((r) => ({ key: r.key, label: r.label, codePrefix: r.code_prefix, sortOrder: r.sort_order }));
}

/** 표가 있어도 그 테넌트에 시드가 없으면(새 학원) 내장 7종으로 그린다 — 자동 추가는 잠근다. */
function withFallback(status: TableStatus, rows: InventoryCategory[]): CategoryData {
  if (status === "ok" && rows.length > 0) return { status, rows, ready: true, fallback: false };
  return { status, rows: [...BUILTIN_CATEGORIES], ready: false, fallback: true };
}

/** 화면(서버 컴포넌트)용 — 세션 클라이언트 + RLS(테넌트 전원 select). */
export async function getInventoryCategories(): Promise<CategoryData> {
  const user = await getCurrentUser();
  if (!user) return withFallback("failed", []);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_categories")
    .select("key, label, code_prefix, sort_order")
    .eq("tenant_id", user.tenantId)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(CATEGORY_LIMIT);
  if (error) {
    const status: TableStatus = isMissingInventoryTable(error) ? "missing-table" : "failed";
    if (status === "failed") reportError(error, { scope: "inventory.categories" });
    return withFallback(status, []);
  }
  return withFallback("ok", toCategories((data ?? []) as Row[]));
}

/**
 * 서버 액션용 — **admin 클라이언트**(쓰기 경로는 service_role이라 읽기도 같은 클라이언트로 맞춘다).
 * ⚠️ admin은 RLS를 우회하므로 `tenant_id` 필터가 필수다.
 */
export async function loadCategoriesForWrite(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<CategoryData> {
  const { data, error } = await admin
    .from("inventory_categories")
    .select("key, label, code_prefix, sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(CATEGORY_LIMIT);
  if (error) {
    const status: TableStatus = isMissingInventoryTable(error) ? "missing-table" : "failed";
    if (status === "failed") reportError(error, { scope: "inventory.categories.write" });
    return withFallback(status, []);
  }
  return withFallback("ok", toCategories((data ?? []) as Row[]));
}
