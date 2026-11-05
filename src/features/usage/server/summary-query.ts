import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { inclusiveDateWindowStart, kstToday } from "@/lib/date-kst";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { isConnectedAppMenu, MENU_KEYS } from "@/lib/permissions";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { parseUsageRows, shapeUsage, type UsageSummary } from "../summary";
import type { UsageQuery } from "../query";

export type TenantOption = { id: string; name: string };

/** 강사 과목 라벨·선택지 — 학원설정 과목(운영 enum 하드코딩 금지). 전 지점이면 지점들의 과목을 합친다(먼저 나온 라벨). */
export type SubjectCatalog = { labels: Record<string, string>; options: { value: string; label: string }[] };

type Common = { tenants: TenantOption[]; subjects: SubjectCatalog };
export type UsageLoad =
  | ({ ok: true; from: string; to: string; summary: UsageSummary } & Common)
  | ({ ok: false; reason: "not_ready" | "error"; detail: string } & Common);

async function subjectCatalog(tenantIds: string[]): Promise<SubjectCatalog> {
  const lists = await Promise.all(
    tenantIds.map((id) =>
      getTenantSettingsByTenantId(id)
        .then((s) => s.operations.subjects)
        .catch((): SubjectSetting[] => []),
    ),
  );
  const merged = new Map<string, SubjectSetting>();
  for (const s of lists.flat()) if (!merged.has(s.key)) merged.set(s.key, s);
  const subjects = [...merged.values()];
  return { labels: subjectLabelRecord(subjects), options: subjects.map((s) => ({ value: s.key, label: s.label })) };
}

/**
 * 슈퍼관리자 '이용 분석' 조회 — 전 지점(RLS 우회)이라 service_role, 그래서 **여기서** 슈퍼관리자를 다시 확인한다.
 * 집계는 DB 함수 한 번(grouping sets → jsonb 하나, B2: 행을 끌어와 JS로 세지 않는다) + 지점 이름 목록 + 과목 라벨, 병렬(B4).
 * ⚠️ 0292a 적용 전이면 함수가 없다 — 화면이 죽지 않게 `not_ready`로 돌려준다([[#95]]).
 */
export async function loadUsage(q: UsageQuery): Promise<UsageLoad> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const to = kstToday();
  const from = inclusiveDateWindowStart(to, q.days);
  // 과목 필터는 고를 때만 싣는다 — 0293a 적용 전(4인자 함수)에도 필터 없는 화면은 그대로 열린다([[#95]]).
  const args = { p_from: from, p_to: to, p_tenant: q.tenantId, p_role: q.role, ...(q.subject ? { p_subject: q.subject } : {}) };
  const tenantsP = fetchAllPaged<TenantOption>((f, t) =>
    admin.from("tenants").select("id, name").order("name").order("id").range(f, t),
  );
  const [rpc, tenants, subjects] = await Promise.all([
    admin.rpc("page_usage_summary", args),
    tenantsP,
    tenantsP.then((ts) => subjectCatalog(q.tenantId ? [q.tenantId] : ts.map((t) => t.id))),
  ]);
  if (rpc.error) {
    const missing = rpc.error.code === "PGRST202" || rpc.error.code === "42883" || rpc.error.code === "42P01";
    return { ok: false, reason: missing ? "not_ready" : "error", detail: rpc.error.message, tenants, subjects };
  }
  // 연결 앱 권한 키(app_* · 2026-11-05)는 화면 방문이 남지 않는 바깥 앱 링크라 '안 쓰는 메뉴'로 세지 않는다.
  return { ok: true, from, to, summary: shapeUsage(parseUsageRows(rpc.data), MENU_KEYS.filter((key) => !isConnectedAppMenu(key)), q.sort), tenants, subjects };
}
