import { getCurrentUser } from "@/lib/auth/current-user";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { capDisabledModules } from "@/lib/modules";
import { canAccess, resolveMatrix, type SystemRole } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import type { TenantSettings } from "@/features/owner/settings-types";
import { loadOverview } from "@/features/dashboard/overview/server";
import { dashboardBundleOf } from "@/features/dashboard/layout/bundle";
import { subjectChoices } from "@/features/dashboard/layout/preview";
import { bundleMenus } from "@/features/dashboard/layout/role-menus";
import { BUNDLES, type Bundle } from "@/features/dashboard/layout/types";
import { DashboardEditorLazy } from "./dashboard-editor-lazy";

/** 역할마다 지금 해당하는 직원 수 — 운영실을 열 수 있는 역할만(강사·대시보드를 막아 둔 역할은 세지 않는다). 개인 예외는 반영하지 않는다. */
async function bundleCounts(settings: TenantSettings, tenantId: string): Promise<Record<Bundle, number>> {
  const counts = Object.fromEntries(BUNDLES.map((b) => [b, 0])) as Record<Bundle, number>;
  try {
    const db = await createClient();
    const [rows, superIds] = await Promise.all([
      fetchAllPaged<{ id: string; system_role: string; subjects: string[] | null }>((from, to) =>
        db.from("users").select("id, system_role, subjects").eq("tenant_id", tenantId).neq("status", "inactive").order("id").range(from, to),
      ),
      getSuperAdminIds(),
    ]);
    const matrix = capDisabledModules(resolveMatrix(settings.permissions.overrides), settings.modules.disabled);
    for (const u of rows) {
      const role = u.system_role as SystemRole;
      const isSuperAdmin = superIds.has(u.id);
      if (!isSuperAdmin && !canAccess(role, "dashboard", matrix)) continue;
      counts[dashboardBundleOf({ systemRole: role, isSuperAdmin, subjects: (u.subjects ?? []).filter((s) => s?.trim()) })] += 1;
    }
  } catch (error) {
    reportError(error, { scope: "owner.dashboard-face.counts" });
  }
  return counts;
}

/**
 * 학원 설정 '대시보드 관리' 면(서버) — 🔴 호출부(`owner/page.tsx`)가 **원장·총괄만** 이 면을 그린다(그 밖은 안내 문구).
 * 실데이터 미리보기 원본(원장 시점 전체 스냅샷)은 **기다리지 않고 흘려 보낸다**(B7 — 운영실 조회는 수 초가 걸린다). 실패하면 null.
 */
export async function DashboardFace({ settings }: { settings: TenantSettings }) {
  const user = await getCurrentUser();
  const preview = loadOverview({ full: true }).catch((error) => {
    reportError(error, { scope: "owner.dashboard-face.preview" });
    return null;
  });
  const counts = user ? await bundleCounts(settings, user.tenantId) : (Object.fromEntries(BUNDLES.map((b) => [b, 0])) as Record<Bundle, number>);
  return (
    <DashboardEditorLazy
      initial={settings.dashboard}
      roleMenus={bundleMenus(settings)}
      subjects={subjectChoices(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])))}
      counts={counts}
      preview={preview}
    />
  );
}
