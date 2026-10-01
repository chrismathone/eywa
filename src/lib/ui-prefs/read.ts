import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * 내 `users.ui_prefs` 원본 — **한 요청에 한 번만** 읽는다(React `cache`).
 *
 * 셸 레이아웃은 메뉴를 열 때마다 도는 자리라(B6) 같은 행을 기능마다 따로 읽으면 왕복이 그만큼 는다 —
 * '자주 방문한 메뉴'(`getMyMenuVisits`)와 '화면 최대화'(`getMyPageMaximized`)가 이 한 번을 나눠 쓴다.
 *
 * ⚠️ **실패해도 화면은 열린다** — 개인 표시 취향이라 막을 이유가 없다(빈 객체로 떨어진다).
 * ⚠️ RLS 우회(admin)라 **`tenant_id`까지 좁힌다**.
 * ⚠️ 쓰기는 [`patchMyUiPrefs`](./patch.ts) — 같은 요청 안에서 쓴 뒤 다시 읽어야 하는 곳은 이 캐시를 쓰지 말 것.
 */
export const readMyUiPrefs = cache(async (): Promise<Record<string, unknown>> => {
  try {
    const user = await getCurrentUser();
    if (!user) return {};
    const { data } = await createAdminClient()
      .from("users")
      .select("ui_prefs")
      .eq("id", user.id)
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
    const raw = data?.ui_prefs;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
});
