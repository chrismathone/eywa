import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_SHEET_LANG, resolveSheetLang, type SheetLang } from "../i18n";
import { readEcsLangPref } from "../view-prefs";

/**
 * 지금 로그인한 사람의 **강사 시트 화면 언어** — 고른 값이 있으면 그것, 없으면 표시 이름에서 도출.
 *
 * 🔑 `cache()`라 한 요청 안에서 **레이아웃과 페이지가 왕복을 나눠 쓴다**(ECS 레이아웃이 provider에
 *    넣고, 서버 컴포넌트인 랜딩 `page.tsx`가 문구를 그릴 때 다시 부른다 — 실제 조회는 1회).
 *    `getCurrentUser()`도 `cache()`라 그 왕복은 어차피 페이지가 치르던 것이고, 여기서 새로 드는 비용은
 *    **`ui_prefs` 단일 행 select 1회**뿐이다(기본키 조회).
 *
 * ⚠️ **조회가 실패해도 화면은 그대로 열린다** — 개인 표시 취향이라 시트를 막을 이유가 없다.
 *    실패 시 이름 기반 기본값(로그인 정보는 이미 있다)으로, 로그인조차 없으면 한국어.
 * ⚠️ RLS 우회(admin)라 **`tenant_id`까지 좁힌다**(다른 설정 액션과 같은 규약).
 * 🔴 세션 클라이언트로 바꾸지 말 것 — `patchMyEcsPrefs`가 admin으로 쓰는 것과 같은 행이라,
 *    읽기만 정책 경로를 타면 "저장은 됐는데 안 읽히는" 비대칭이 생길 수 있다.
 */
export const getEcsLang = cache(async (): Promise<SheetLang> => {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_SHEET_LANG;
  try {
    const { data } = await createAdminClient()
      .from("users")
      .select("ui_prefs")
      .eq("id", user.id)
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
    return resolveSheetLang(readEcsLangPref(data?.ui_prefs), user.displayName);
  } catch {
    // 조회 실패 = "아직 안 골랐다"와 같은 취급. 이름은 이미 알고 있으니 그 기본값으로 연다.
    return resolveSheetLang(null, user.displayName);
  }
});
