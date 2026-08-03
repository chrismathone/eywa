/**
 * ECS 보기 설정 — `users.ui_prefs.ecs` 네임스페이스(글씨 크기와 **같은 자리·같은 부분병합 규약**).
 *
 * `showSpecialRooms` = 자리(LAB·JJ) 교시를 시트에 그릴지. **기본은 표시**(원장 2026-08-03 "LAB과 JJ 오픈시켜").
 *
 * 🔴 왜 설정이 됐나: 2026-07-31엔 코드가 **무조건 숨겼다**("실제 담임이 아닌 랩실은 숨겨"). 그런데 그 자리엔
 *    실제로 계획·마크가 쌓여 있어(실측 계획 116행·마크 412건) 숨김이 곧 "쓴 게 화면에서 사라짐"이었다.
 *    숨기고 싶은 주와 봐야 하는 주가 갈리므로 **코드가 정하지 않고 상단 헤더에서 고른다.**
 *
 * ⚠️ 이 값은 **표시뿐 아니라 작성률 분모도 함께** 바꾼다(`buildWeekGrid`/`scheduledSlotKeySet`의
 *    `includeSpecialRooms`). 화면에서 뺀 교시를 분모에 남기면 아무리 써도 100%에 못 닿고, 반대로 그리면서
 *    분모에서만 빼면 "카드 6개인데 5교시"가 된다 — **보이는 교시 = 세는 교시**가 이 설정의 계약이다.
 * ⚠️ 계정 귀속이라 다른 PC에서도 같은 상태로 열린다. 서버가 진실이므로 토글은 저장 후 새로고침한다
 *    (헤더의 `계획 N/M교시`·랜딩 카드가 서버 계산이라 클라에서만 감추면 숫자가 갈린다).
 */

/** 미설정 기본값 = 표시(원장 2026-08-03). 저장은 기본값이 아닐 때만 키를 남긴다. */
export const DEFAULT_ECS_SHOW_SPECIAL_ROOMS = true;

/** `users.ui_prefs` → 자리(LAB·JJ) 표시 여부(`ecs` 네임스페이스만 읽는다 — 다른 화면 값 훔치기 금지). */
export function readEcsShowSpecialRooms(uiPrefs: unknown): boolean {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) {
    return DEFAULT_ECS_SHOW_SPECIAL_ROOMS;
  }
  const scope = (uiPrefs as Record<string, unknown>).ecs;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return DEFAULT_ECS_SHOW_SPECIAL_ROOMS;
  }
  const raw = (scope as Record<string, unknown>).showSpecialRooms;
  // 모르는 값(문자열·null 등)은 기본값 — 저장값이 깨져도 교시가 통째로 사라지지 않게.
  return typeof raw === "boolean" ? raw : DEFAULT_ECS_SHOW_SPECIAL_ROOMS;
}
