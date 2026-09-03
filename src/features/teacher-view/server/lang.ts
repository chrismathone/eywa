import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { DEFAULT_SHEET_LANG, resolveSheetLang, type SheetLang } from "../i18n";
import { readTeacherLangPref } from "../view-prefs";

/**
 * 지금 화면의 **강사뷰 언어** — 고른 값이 있으면 그것, 없으면 표시 이름에서 도출.
 *
 * 🔴 **강사 미니셸일 때만 영어가 될 수 있다**(원장 2026-09-03 *"관리자뷰는 수정할 필요 없고"*).
 *    판정은 셸이 이미 쓰는 [`getShellView()`](@/lib/auth/view-mode) 그대로 — **새 판정을 만들지 않는다**
 *    (겸직자가 '관리자뷰로 전환'하면 `view`가 바뀌므로 이 함수도 자동으로 한국어로 돌아간다).
 * 🔑 이 게이트가 없으면 사무실이 사이드바로 여는 `/ecs`·`/attendance`가 **관리자뷰인데 영어로** 뜬다 —
 *    같은 페이지가 두 셸에서 렌더되기 때문이다(클라 쪽은 provider가 미니셸에만 있어 이미 안전하지만,
 *    서버 컴포넌트는 이 함수를 직접 부르므로 여기서 같은 답을 내야 한다).
 *
 * 🔑 `cache()`라 한 요청 안에서 **셸 레이아웃과 페이지가 왕복을 나눠 쓴다**(실제 조회 1회).
 *    `getCurrentUser()`·`getShellView()`도 캐시라 새로 드는 비용은 **`ui_prefs` 단일 행 select 1회**뿐이다.
 *
 * ⚠️ **조회가 실패해도 화면은 그대로 열린다** — 개인 표시 취향이라 막을 이유가 없다.
 * ⚠️ RLS 우회(admin)라 **`tenant_id`까지 좁힌다**.
 */
export const getTeacherViewLang = cache(async (): Promise<SheetLang> => {
  const [user, view] = await Promise.all([getCurrentUser(), getShellView()]);
  if (!user || view !== "teacher") return DEFAULT_SHEET_LANG;
  try {
    const { data } = await createAdminClient()
      .from("users")
      .select("ui_prefs")
      .eq("id", user.id)
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
    return resolveSheetLang(readTeacherLangPref(data?.ui_prefs), user.displayName);
  } catch {
    // 조회 실패 = "아직 안 골랐다"와 같은 취급. 이름은 이미 알고 있으니 그 기본값으로 연다.
    return resolveSheetLang(null, user.displayName);
  }
});
