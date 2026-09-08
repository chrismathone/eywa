import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MENU_VISITS_KEY, MENU_VISITS_NS, parseVisits, type MenuVisitMap } from "../menu-visits";

/**
 * 내 메뉴 방문 기록 — 왼쪽 '자주 방문한 메뉴'가 쓴다.
 * ⚠️ 셸 레이아웃은 **창마다** 도는 자리라(B6) 실패해도 화면을 막지 않고 빈 값으로 떨어진다.
 */
export async function getMyMenuVisits(): Promise<MenuVisitMap> {
  const user = await getCurrentUser();
  if (!user) return {};
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const prefs = (data?.ui_prefs ?? {}) as Record<string, unknown>;
  const nav = (prefs[MENU_VISITS_NS] ?? {}) as Record<string, unknown>;
  return parseVisits(nav[MENU_VISITS_KEY]);
}
