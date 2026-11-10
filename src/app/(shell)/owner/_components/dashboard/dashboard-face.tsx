import { getCurrentUser } from "@/lib/auth/current-user";
import { platformAccountIds } from "@/features/owner/server/platform-settings";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import type { TenantSettings } from "@/features/owner/settings-types";
import { dashboardMembers, type DashboardMembers, type MemberRow } from "@/features/dashboard/layout/members";
import { subjectChoices } from "@/features/dashboard/layout/preview";
import { bundleMenus } from "@/features/dashboard/layout/role-menus";
import { DashboardEditorLazy } from "./dashboard-editor-lazy";

async function assignedMembers(settings: TenantSettings, tenantId: string): Promise<DashboardMembers> {
  try {
    const db = await createClient();
    const rows = await fetchAllPaged<MemberRow>((from, to) =>
      db.from("users").select("id, display_name, system_role, subjects, status").eq("tenant_id", tenantId).eq("status", "active").neq("system_role", "student").order("id").range(from, to),
    );
    const superIds = await platformAccountIds(rows.map((row) => row.id));
    return { people: dashboardMembers(rows, superIds, settings).filter((person) => person.bundle !== "super"), failed: false };
  } catch (error) {
    reportError(error, { scope: "owner.dashboard-face.counts" });
  }
  return { people: [], failed: true };
}

/**
 * 학원 설정 '대시보드 관리' 면(서버) — 🔴 호출부(`owner/page.tsx`)가 **원장·총괄만** 이 면을 그린다(그 밖은 안내 문구).
 * 미리보기는 역할이 보는 칸 모양만 그린다(값 없음) — 옛 실데이터 미리보기 원본(원장 시점 전체 운영실 조회)은 더 읽지 않는다.
 */
export async function DashboardFace({ settings, readOnly = false }: { settings: TenantSettings; readOnly?: boolean }) {
  const user = await getCurrentUser();
  const members = user ? await assignedMembers(settings, user.tenantId) : { people: [], failed: true };
  return (
    <DashboardEditorLazy
      initial={settings.dashboard}
      roleMenus={bundleMenus(settings)}
      subjects={subjectChoices(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])))}
      members={members}
      readOnly={readOnly}
    />
  );
}
