import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isStaffInSubjectScope, staffSubjectScopeOf } from "../subject-scope";

/**
 * 보는 사람의 직원관리 과목 범위 — null = 전체(범위 없음 · 원장 역할 · super_admin).
 * 🔴 원장 역할에는 범위를 걸지 않는다 — 원장은 그 지점의 전부를 본다(원장 2026-10-06). 범위 줄이 저장돼 있어도 무시한다.
 * 범위는 학원 설정이 정한다(`permissions.specialAccess.staffSubjectScopes` — 설정은 요청마다 한 번만 읽힌다).
 * 범위가 안 걸린 사람은 super_admin 조회도 건너뛴다(대부분의 호출이 여기서 끝난다).
 */
export async function getViewerStaffScope(viewer: { id: string }): Promise<readonly string[] | null> {
  const settings = await getTenantSettings();
  const scope = staffSubjectScopeOf(viewer.id, settings.permissions.specialAccess.staffSubjectScopes);
  if (!scope) return null;
  // 보는 사람 = 지금 로그인한 사람이다(모든 호출부가 그렇게 부른다) — 역할은 세션에서 읽는다(요청마다 한 번, 캐시).
  const [me, isSuperAdmin] = await Promise.all([getCurrentUser(), isCurrentUserSuperAdmin()]);
  if (isSuperAdmin || (me?.id === viewer.id && me.systemRole === "master")) return null;
  return scope;
}

/**
 * 이 직원을 볼 수 있는가(목록 밖 표면 공용 — 상세·근무 설정·이력서·계정·계약 액션).
 * 본인은 항상 통과. 범위가 걸려 있으면 대상의 담당 과목을 **DB에서 다시 읽어** 판정한다
 * (화면이 보낸 값은 안 믿는다, [[#77]]). 대상을 못 찾으면 false.
 */
export async function canSeeStaffMember(
  viewer: { id: string; tenantId: string },
  targetId: string,
  knownSubjects?: readonly string[] | null,
): Promise<boolean> {
  if (targetId === viewer.id) return true;
  const scope = await getViewerStaffScope(viewer);
  if (!scope) return true;
  if (knownSubjects !== undefined) return isStaffInSubjectScope(scope, knownSubjects);
  const { data } = await createAdminClient()
    .from("users")
    .select("subjects")
    .eq("id", targetId)
    .eq("tenant_id", viewer.tenantId)
    .maybeSingle();
  if (!data) return false;
  return isStaffInSubjectScope(scope, Array.isArray(data.subjects) ? (data.subjects as string[]) : []);
}

export const STAFF_SCOPE_DENIED_MSG = "담당 과목 밖의 직원은 볼 수 없습니다";
