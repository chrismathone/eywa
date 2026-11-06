import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { DEFAULT_SHEET_LANG, resolveSheetLang, type SheetLang } from "../i18n";
import { readTeacherLangPref } from "../view-prefs";
import { parseSheetLang } from "../i18n";

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
 *
 * 🔑 '다른 강사 뷰'(원장 A가 강사 X 화면, 원장 2026-11-05 강사뷰 전수)에서는 **두 사람의 값을 나눠 읽는다**:
 *    ① 본인이 고른 값(`ui_prefs`) = **보는 사람 A** — 개인 표시 설정이라 실제 계정이다. 화면의 언어 스위치
 *       (`setMyTeacherLang` → `patchMyUiPrefs`)도 A의 ui_prefs에 쓰므로, 여기서 X의 값을 읽으면 스위치가 듣지 않는다.
 *    ② 관리자 지정(`teacher_view_lang`)·③ 이름 도출 = **대상 X** — "X의 화면은 기본으로 이 언어"라는 X에 대한 사실이다.
 *    그래서 원어민 강사의 화면을 열면 기본은 X가 보는 그 언어이고, A가 스위치로 고르면 A의 선택이 이긴다.
 */
export const getTeacherViewLang = cache(async (): Promise<SheetLang> => {
  const [viewer, target, view] = await Promise.all([getCurrentUser(), getCurrentUser({ teacherView: true }), getShellView()]);
  if (!viewer || !target || view !== "teacher") return DEFAULT_SHEET_LANG;
  const admin = createAdminClient();
  // 🔴 두 값을 **따로** 읽는다 — `teacher_view_lang`은 0248a라 미적용일 수 있고, 한 select에 함께
  //    실으면 컬럼 부재가 PostgREST 400이 되어 `ui_prefs`까지 못 읽는다([[#95]] — 강사 셸은 전원이
  //    매일 여는 경로라 통째로 죽는다). 서로 독립이라 병렬로(B4).
  // ⚠️ supabase 쿼리 빌더는 `PromiseLike`라 `.catch()`가 없다 — async 함수로 감싸 try/catch 한다.
  const readPref = async (): Promise<SheetLang | null> => {
    try {
      const { data } = await admin
        .from("users")
        .select("ui_prefs")
        .eq("id", viewer.id)
        .eq("tenant_id", viewer.tenantId)
        .maybeSingle();
      return readTeacherLangPref(data?.ui_prefs);
    } catch {
      return null;
    }
  };
  // 관리자 지정(0248a). 컬럼이 없으면 error가 오고 그때는 **지정 없음**으로 떨어진다(화면은 산다).
  const readOverride = async (): Promise<SheetLang | null> => {
    try {
      const { data, error } = await admin
        .from("users")
        .select("teacher_view_lang")
        .eq("id", target.id)
        .eq("tenant_id", target.tenantId)
        .maybeSingle();
      return error ? null : parseSheetLang(data?.teacher_view_lang);
    } catch {
      return null;
    }
  };
  const [prefs, override] = await Promise.all([readPref(), readOverride()]);
  return resolveSheetLang(prefs, override, target.displayName);
});
