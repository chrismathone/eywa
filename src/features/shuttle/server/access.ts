import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { canAccess } from "@/lib/permissions";
import { getShuttleDuty } from "./duty";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canOpenShuttleAdmin } from "../admin-access";
import { isModuleOnForTenant } from "@/features/owner/server/modules";

/**
 * 셔틀 화면 **열람** 게이트 — 메뉴 권한(`shuttle`) **또는** 직원 '셔틀 담당' 토글(0227a).
 *
 * 🔴 착지와 짝이다: 담당 토글을 켠 계정은 로그인 착지가 `/shuttle/today`라서, 이 우회가 없으면
 *    착지 → requireAccess 거부 → 다시 착지로 **무한히 돈다**(teacher-home의 ECS 홈과 같은 함정).
 * 🔑 쓰기는 여기서 정하지 않는다 — 편성은 `canWriteTenant("shuttle")`(사무실), 등하원 기록은
 *    `canRecordBoarding`(현장)이 각각 판정한다. 이 함수는 "화면을 열 수 있나"까지다.
 * ⚠️ 순서가 성능이다 — 매트릭스는 요청당 캐시(레이아웃이 이미 부름)라 통과하면 왕복 0이고,
 *    토글 조회(admin 1왕복)는 **메뉴 권한이 없을 때만** 든다.
 * 🔑 담당 토글·역할은 **화면 주인**(강사뷰면 검증된 대상) — 메뉴 권한이 이미 대상 것이라 토글만 실제 계정으로 보면
 *    셔틀 담당 X의 화면이 열리지 않았다(2026-11-05 점검). 돌려주는 사람도 대상이다.
 */
export async function requireShuttleView(): Promise<CurrentUser> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) redirect("/login");
  if (!(await isModuleOnForTenant(user.tenantId, "shuttle"))) notFound();
  const matrix = await getUserPermMatrix();
  if (canAccess(user.systemRole, "shuttle", matrix)) return user;
  if (await getShuttleDuty(user.id, user.tenantId)) return user;
  redirect(await landingPath(user.systemRole, matrix));
}

/**
 * 셔틀 **관리자 화면**(실시간 위치 · 탑승 학생 시간표 · 가까운 노선 찾기 — 학부모 관리 현황은 `parentAccountsActor`)을 볼 수 있나.
 * 판정 = `canOpenShuttleAdmin`(운영 계정 · 또는 셔틀 권한 + '셔틀 관리자 화면' 권한 — 원장 2026-11-10 결정 · 기본 원장·관리자).
 * 전에는 코드의 역할 비교(원장·관리자·총괄 — 사용자 2026-10-08 "관리자 계정들만")였다. 메뉴판 입구도 같은 함수를 지난다(입구·화면이 갈리지 않게).
 * 🔑 역할·표는 **화면 주인**의 것 — 강사뷰로 강사 X를 열었으면 X의 역할(강사)이라 관리자 화면이 닫힌다(실제 계정 역할로 열리던 구멍).
 */
export async function isShuttleAdmin(): Promise<boolean> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return false;
  const [matrix, isSuperAdmin] = await Promise.all([getUserPermMatrix(), isCurrentUserSuperAdmin()]);
  return canOpenShuttleAdmin(user.systemRole, matrix, isSuperAdmin);
}
