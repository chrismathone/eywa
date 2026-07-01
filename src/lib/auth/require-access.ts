import "server-only";
import { redirect } from "next/navigation";
import { canAccess, roleHome, type MenuKey } from "@/lib/permissions";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { getPermMatrix } from "./perm-matrix";

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
  const matrix = await getPermMatrix(); // 테넌트 override 반영 매트릭스(요청당 1회 cache)
  // 권한 없음: 역할 홈으로 폴백(강사=/onescreen, 학생=/my-learning, 그 외=대시보드/랜딩). 단일 소스 roleHome.
  // (강사가 /dashboard 등 강제 URL 진입 시 owner 대시보드 대신 원스크린으로.) 강사/학생 홈은 ROLE_LOCKED라 루프 없음.
  if (!canAccess(user.systemRole, menu, matrix)) {
    redirect(roleHome(user.systemRole, matrix));
  }
  return user;
}
