import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 급여 정책·반별 급여·강사 정산 면의 게이트 — **원장(master) 또는 총괄(super_admin)**.
 *
 * CLAUDE.md 결정: *"super_admin은 새로 만드는 어떤 제한 명단·게이트도 자동 통과"*(2026-08-13).
 * 종전엔 master만 비교해 총괄 계정의 역할이 master가 아니면 강사 정산 탭·반별 급여·급여 정책이 막혔다(감사 D6).
 * 🔴 class_salary_settings는 master 전용 RLS(0130a)라 총괄(비-master)은 세션 클라이언트로 **에러 없이 0행**이다
 *    ([[#104]]) → 이 게이트를 통과한 뒤의 읽기·쓰기는 admin 클라이언트 + 명시 tenant_id 필터로 한다.
 */
export async function canManageSalary(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return user.systemRole === "master" || (await isCurrentUserSuperAdmin());
}
