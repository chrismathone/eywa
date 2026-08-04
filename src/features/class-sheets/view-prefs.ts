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
import { normalizeEnglishTrackFilter, type EnglishTrackFilter } from "@/features/classes/english-track";

/** 미설정 기본값 = 표시(원장 2026-08-03). 저장은 기본값이 아닐 때만 키를 남긴다. */
export const DEFAULT_ECS_SHOW_SPECIAL_ROOMS = true;

/**
 * `ui_prefs.ecs.englishTrack` → 랜딩의 프로그램 보기 필터(전체/EiE/인재원 영어, 0176a).
 *
 * ⚠️ **`showSpecialRooms`와 축이 다르다** — 저쪽은 '자리(방)' 교시를 그릴지고, 이건 '반이 어느 프로그램인지'다.
 *    두 값은 곱해져 걸린다(예: EiE만 보면서 LAB·JJ는 숨김). 하나로 합치지 말 것.
 * ⚠️ 이 필터는 **작성률 분모를 바꾸지 않는다**(showSpecialRooms와 결정적으로 다른 점). 목록에서 눈으로
 *    좁혀 보는 용도라 각 카드의 `N/M교시`는 필터와 무관하게 그 반의 값 그대로다.
 * ⚠️ 계정 귀속(원장 2026-08-04 *"모든 뷰 세팅은 계정에 귀속"*) — 다른 PC에서도 같은 필터로 열린다.
 */
export const DEFAULT_ECS_ENGLISH_TRACK: EnglishTrackFilter = "all";

/** `users.ui_prefs` → 프로그램 보기 필터(`ecs` 네임스페이스만 읽는다). 깨진 값은 '전체'로. */
export function readEcsEnglishTrack(uiPrefs: unknown): EnglishTrackFilter {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return DEFAULT_ECS_ENGLISH_TRACK;
  const scope = (uiPrefs as Record<string, unknown>).ecs;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return DEFAULT_ECS_ENGLISH_TRACK;
  // 모르는 값이면 '전체' — 저장값이 깨졌다고 반 목록이 통째로 비면 "반이 사라졌다"가 된다.
  return normalizeEnglishTrackFilter((scope as Record<string, unknown>).englishTrack);
}

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
