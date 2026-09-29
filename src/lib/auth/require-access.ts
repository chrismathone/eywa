import "server-only";
import { notFound, redirect } from "next/navigation";
import { canAccess, type MenuKey } from "@/lib/permissions";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { getUserPermMatrix } from "./perm-matrix";
import { landingPath } from "./teacher-home";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled, moduleOfMenuKey } from "@/lib/modules";

/**
 * Server-side permissions guard. Drop into the top of any page server
 * component that should be gated. Sends users without a session to
 * /login, and users without the right role to their dashboard (or the
 * public landing if their role can't access the dashboard either).
 *
 * The sidebar already hides the link, but typing the URL directly
 * should also be blocked. RLS protects the data either way; this is
 * defence in depth + a nicer UX than rendering a half-empty page.
 */
export async function requireAccess(menu: MenuKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const matrix = await getUserPermMatrix(); // 테넌트 override + 개인 예외 반영 매트릭스(요청당 1회 cache)
  // 권한 없음: 역할 홈으로 폴백(강사=원스크린 or ECS, 학생=/my-learning, 그 외=대시보드/랜딩).
  // 단일 소스 landingPath — 강사 홈은 담당 과목으로 갈린다(영어 전담=ECS, 2026-08-07).
  // (강사가 /dashboard 등 강제 URL 진입 시 owner 대시보드 대신 자기 홈으로.) 강사/학생 홈은 ROLE_LOCKED라 루프 없음.
  // ⚠️ 비용은 **거부 경로에서만** 든다 — 통과하면 landingPath를 부르지 않는다(happy path 쿼리 0).
  if (!canAccess(user.systemRole, menu, matrix)) {
    // ⚠️ 페이지 렌더 전용 — 서버 액션은 이 함수를 모듈 메뉴에 쓰지 않는다(액션 게이트는 null/{error}를 돌려준다).
    // 거부 이유가 "이 학원에서 끈 기능(모듈)"이면 **없는 주소**(404) — 기능 이름을 말하지 않는다
    // (원장 2026-09-30 *"스위치가 꺼져있을때 이 기능이 있었는지조차 모르게"*). 침산은 꺼진 모듈이 없어 이 갈래를 타지 않는다.
    const mod = moduleOfMenuKey(menu);
    if (mod && !isModuleEnabled((await getTenantSettings()).modules.disabled, mod)) notFound();
    redirect(await landingPath(user.systemRole, matrix));
  }
  return user;
}
