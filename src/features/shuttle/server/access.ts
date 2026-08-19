import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { canAccess } from "@/lib/permissions";
import { getShuttleDuty } from "./duty";

/**
 * 셔틀 화면 **열람** 게이트 — 메뉴 권한(`shuttle`) **또는** 직원 '셔틀 담당' 토글(0227a).
 *
 * 🔴 착지와 짝이다: 담당 토글을 켠 계정은 로그인 착지가 `/shuttle/today`라서, 이 우회가 없으면
 *    착지 → requireAccess 거부 → 다시 착지로 **무한히 돈다**(teacher-home의 ECS 홈과 같은 함정).
 * 🔑 쓰기는 여기서 정하지 않는다 — 편성은 `canWriteTenant("shuttle")`(사무실), 등하원 기록은
 *    `canRecordBoarding`(현장)이 각각 판정한다. 이 함수는 "화면을 열 수 있나"까지다.
 * ⚠️ 순서가 성능이다 — 매트릭스는 요청당 캐시(레이아웃이 이미 부름)라 통과하면 왕복 0이고,
 *    토글 조회(admin 1왕복)는 **메뉴 권한이 없을 때만** 든다.
 */
export async function requireShuttleView(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const matrix = await getUserPermMatrix();
  if (canAccess(user.systemRole, "shuttle", matrix)) return user;
  if (await getShuttleDuty(user.id, user.tenantId)) return user;
  redirect(await landingPath(user.systemRole, matrix));
}
