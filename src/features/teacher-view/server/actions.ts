"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { parseSheetLang } from "../i18n";
import { TEACHER_VIEW_PREFS_NS } from "../view-prefs";

/**
 * 강사뷰 **화면 언어**(한국어/English)를 본인 계정에 저장 — `users.ui_prefs.teacherView.lang`
 * (2026-09-03, **마이그레이션 0건**).
 *
 * 🔴 **기본값과 같아도 지우지(생략하지) 않는다** — 다른 ui_prefs 규약은 "기본값이면 키를 지운다"지만
 *    여기 기본값은 **표시 이름에서 도출**된다(원어민=영어). 이름은 바뀔 수 있어서(원어민 이름을 나중에
 *    한글로 등록하는 등) 키를 지우면 **본인이 고른 언어가 조용히 뒤집힌다**. 고른 사실 자체가 정보다.
 * ⚠️ 서버가 진실이다 — 셸 레이아웃(서버)이 언어를 읽어 provider에 넣으므로 호출부가 저장 후
 *    `router.refresh()`를 해야 크롬·서버 컴포넌트 문구가 함께 바뀐다.
 * ⚠️ 게이트는 **로그인만** — 내 계정의 표시 취향이라 반·메뉴 권한과 무관하다(권한을 한 글자도 안 바꾼다).
 * 🔴 네임스페이스(`teacherView`)는 여기서 **코드로 고정**한다 — 클라가 고르게 하면 아무 화면 설정이나
 *    덮어쓸 수 있다(그래서 `patchMyUiPrefs`는 서버 액션이 아니다).
 */
export async function setMyTeacherLang(lang: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseSheetLang(lang);
  if (!parsed) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs(TEACHER_VIEW_PREFS_NS, { lang: parsed });
}
