/**
 * 강사뷰 보기 설정 — `users.ui_prefs.teacherView` 네임스페이스.
 *
 * 🔴 왜 `ecs`가 아니라 별도 네임스페이스인가: 언어는 **영어 강사 시트 한 화면의 설정이 아니라
 *    강사가 여는 화면 전체의 설정**이다(원장 2026-09-03 *"강사로 로그인했을때 화면이야 '영어 강사
 *    시트' 하나만 적용하는것이 아님"*). `ui_prefs.ecs`에 두면 다음 사람이 "ECS 설정"으로 읽고
 *    ECS 안에서만 소비하게 된다.
 */
import { parseSheetLang, type SheetLang } from "./i18n";

/** ui_prefs 네임스페이스 — 액션·리더가 **같은 상수**를 쓴다(문자열을 두 곳에 적으면 갈린다). */
export const TEACHER_VIEW_PREFS_NS = "teacherView";

/**
 * `ui_prefs.teacherView.lang` → 이 사람이 **고른** 화면 언어(한국어/English).
 *
 * 🔴 다른 설정들과 달리 **기본값을 여기서 못 정한다** — 미설정 기본은 표시 이름에서 도출하는데
 *    (`defaultSheetLangFor`: 이름에 한글이 있으면 한국어) 이 함수는 이름을 모른다. 그래서 여기선
 *    "고른 값이 있나"만 답하고(없으면 null), 합치는 것은 [`resolveSheetLang`](./i18n.ts)이 한다.
 * ⚠️ 계정 귀속(원장 2026-08-04 *"모든 뷰 세팅은 계정에 귀속"*) — 원어민 강사가 학원 어느 PC에서
 *    열어도 영어로 열린다. localStorage면 포트가 바뀌는 순간 한글로 돌아간다([[#90]]).
 * ⚠️ 이 값은 **표시뿐**이다 — 권한·작성률 분모·저장되는 데이터를 한 글자도 바꾸지 않는다.
 */
export function readTeacherLangPref(uiPrefs: unknown): SheetLang | null {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return null;
  const scope = (uiPrefs as Record<string, unknown>)[TEACHER_VIEW_PREFS_NS];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  return parseSheetLang((scope as Record<string, unknown>).lang);
}
