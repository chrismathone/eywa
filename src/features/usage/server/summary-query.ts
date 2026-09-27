import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { inclusiveDateWindowStart, kstToday } from "@/lib/date-kst";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { MENU_KEYS } from "@/lib/permissions";
import { parseUsageRows, shapeUsage, type UsageSummary } from "../summary";
import type { UsageQuery } from "../query";

export type TenantOption = { id: string; name: string };

export type UsageLoad =
  | { ok: true; from: string; to: string; summary: UsageSummary; tenants: TenantOption[] }
  | { ok: false; reason: "not_ready" | "error"; detail: string; tenants: TenantOption[] };

/**
 * 슈퍼관리자 '이용 분석' 조회 — 전 지점(RLS 우회)이라 service_role, 그래서 **여기서** 슈퍼관리자를 다시 확인한다.
 * 집계는 DB 함수 한 번(grouping sets → jsonb 하나, B2: 행을 끌어와 JS로 세지 않는다) + 지점 이름 목록, 둘은 병렬(B4).
 * ⚠️ 0292a 적용 전이면 함수가 없다 — 화면이 죽지 않게 `not_ready`로 돌려준다([[#95]]).
 */
export async function loadUsage(q: UsageQuery): Promise<UsageLoad> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const to = kstToday();
  const from = inclusiveDateWindowStart(to, q.days);
  const [rpc, tenants] = await Promise.all([
    admin.rpc("page_usage_summary", { p_from: from, p_to: to, p_tenant: q.tenantId, p_role: q.role }),
    fetchAllPaged<TenantOption>((f, t) =>
      admin.from("tenants").select("id, name").order("name").order("id").range(f, t),
    ),
  ]);
  if (rpc.error) {
    const missing = rpc.error.code === "PGRST202" || rpc.error.code === "42883" || rpc.error.code === "42P01";
    return { ok: false, reason: missing ? "not_ready" : "error", detail: rpc.error.message, tenants };
  }
  return { ok: true, from, to, summary: shapeUsage(parseUsageRows(rpc.data), MENU_KEYS, q.sort), tenants };
}
