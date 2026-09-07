"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { MENU_VISITS_KEY, MENU_VISITS_NS, bumpVisit, parseVisits } from "../menu-visits";

/**
 * 메뉴를 열었다는 사실 1회 기록 — 왼쪽 '자주 방문한 메뉴' 목록의 재료(원장 2026-09-07).
 *
 * 🔴 **본 동작을 절대 막지 않는다** — 창은 이미 열렸고 이건 뒤따르는 기록이다(실패해도 조용히 넘어간다).
 * 🔴 클라가 주는 것은 `menuKey` 하나뿐이고 **아는 키인지 서버가 확인**한다(임의 문자열이 jsonb에 쌓이지 않게).
 * ⚠️ 읽고-쓰기라 같은 순간 두 창에서 열면 한 번이 덜 세질 수 있다 — 순위 표시용 숫자라 그 정도는 허용한다
 *    (원자적 증가를 위해 RPC를 새로 만들 만한 값이 아니다).
 */
export async function recordMenuVisit(menuKey: string): Promise<void> {
  if (!(MENU_KEYS as readonly string[]).includes(menuKey)) return;
  const user = await getCurrentUser();
  if (!user) return;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const prefs = (row?.ui_prefs ?? {}) as Record<string, unknown>;
  const nav = (prefs[MENU_VISITS_NS] ?? {}) as Record<string, unknown>;
  const next = bumpVisit(parseVisits(nav[MENU_VISITS_KEY]), menuKey as MenuKey, Date.now());
  await patchMyUiPrefs(MENU_VISITS_NS, { [MENU_VISITS_KEY]: next });
}
