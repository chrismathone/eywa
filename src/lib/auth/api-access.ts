import "server-only";
import { canAccess, type MenuKey } from "@/lib/permissions";
import { getCurrentUser, type CurrentUser } from "./current-user";

export type ApiAccessResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403 };

/**
 * Route handler용 권한 가드. requireAccess(페이지용)와 달리 redirect하지 않고
 * 401/403을 반환한다 — redirect는 route handler에서 NEXT_REDIRECT→HTML 응답이 되어
 * client fetch가 JSON 대신 HTML을 받아 깨지기 때문. RLS(테넌트 격리)는 server-only
 * 쿼리(cookies adapter)가 별도로 강제하고, 이 가드는 메뉴 권한만 본다.
 */
export async function apiAccess(menu: MenuKey): Promise<ApiAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };
  if (!canAccess(user.systemRole, menu)) return { ok: false, status: 403 };
  return { ok: true, user };
}
