import "server-only";
import { redirect } from "next/navigation";
import { canAccess, type MenuKey } from "@/lib/permissions";
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
  // 권한 없음: 대시보드 접근 가능하면 대시보드로, 아니면(예: student) 공개 랜딩으로.
  // 대시보드 미접근 role을 /dashboard로 보내면 그 페이지가 또 막혀 리다이렉트 루프가 난다.
  if (!canAccess(user.systemRole, menu, matrix)) {
    redirect(canAccess(user.systemRole, "dashboard", matrix) ? "/dashboard" : "/");
  }
  return user;
}
