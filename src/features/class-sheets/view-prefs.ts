/**
 * ECS 보기 설정 — `users.ui_prefs.ecs` 네임스페이스(글씨 크기와 **같은 자리·같은 부분병합 규약**).
 *
 * `showSelfStudy` = **JJ**(집중자율수업실) 교시를 시트에 그릴지. **기본은 표시**(원장 2026-08-03 "오픈시켜").
 *
 * 🔴 왜 설정이 됐나: 2026-07-31엔 코드가 **무조건 숨겼다**("실제 담임이 아닌 랩실은 숨겨"). 그런데 그 자리엔
 *    실제로 계획·마크가 쌓여 있어(실측 계획 116행·마크 412건) 숨김이 곧 "쓴 게 화면에서 사라짐"이었다.
 *    숨기고 싶은 주와 봐야 하는 주가 갈리므로 **코드가 정하지 않고 상단 헤더에서 고른다.**
 * 🔴 **LAB은 이 토글의 대상이 아니다**(2026-08-06부터 항상 제외 — 전용 출석부로 이관 예정). 판정은
 *    [`grid.ts`](./lib/grid.ts) `hiddenSeatOf` 단일 소스. 여기에 LAB 스위치를 다시 만들지 말 것.
 *
 * ⚠️ 이 값은 **표시뿐 아니라 작성률 분모도 함께** 바꾼다(`buildWeekGrid`/`scheduledSlotKeySet`의
 *    `includeSelfStudy`). 화면에서 뺀 교시를 분모에 남기면 아무리 써도 100%에 못 닿고, 반대로 그리면서
 *    분모에서만 빼면 "카드 6개인데 5교시"가 된다 — **보이는 교시 = 세는 교시**가 이 설정의 계약이다.
 * ⚠️ 계정 귀속이라 다른 PC에서도 같은 상태로 열린다. 서버가 진실이므로 토글은 저장 후 새로고침한다
 *    (헤더의 `계획 N/M교시`·랜딩 카드가 서버 계산이라 클라에서만 감추면 숫자가 갈린다).
 */
import { normalizeEnglishTrackFilter, type EnglishTrackFilter } from "@/features/classes/english-track";
import type { RosterGroupKey } from "./lib/roster-order";

/** 미설정 기본값 = 표시(원장 2026-08-03). 저장은 기본값이 아닐 때만 키를 남긴다. */
export const DEFAULT_ECS_SHOW_SELF_STUDY = true;

/**
 * 저장 키는 **`showSpecialRooms` 그대로 둔다** — 2026-08-06에 뜻이 좁아졌을 뿐(LAB·JJ → JJ) 사람이 고른
 * 선택은 같다("자율 자리를 숨기고 싶다"). 키를 새로 파면 이미 '숨김'을 골라 둔 계정이 조용히 초기화된다.
 */
const SELF_STUDY_PREF_KEY = "showSpecialRooms";

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
  const scope = ecsScope(uiPrefs);
  if (!scope) return DEFAULT_ECS_ENGLISH_TRACK;
  // 모르는 값이면 '전체' — 저장값이 깨졌다고 반 목록이 통째로 비면 "반이 사라졌다"가 된다.
  return normalizeEnglishTrackFilter(scope.englishTrack);
}

/** `users.ui_prefs` → JJ 표시 여부(`ecs` 네임스페이스만 읽는다 — 다른 화면 값 훔치기 금지). */
export function readEcsShowSelfStudy(uiPrefs: unknown): boolean {
  const scope = ecsScope(uiPrefs);
  const raw = scope?.[SELF_STUDY_PREF_KEY];
  // 모르는 값(문자열·null 등)은 기본값 — 저장값이 깨져도 교시가 통째로 사라지지 않게.
  return typeof raw === "boolean" ? raw : DEFAULT_ECS_SHOW_SELF_STUDY;
}

/**
 * 로스터 섹션(재원·퇴원·기록) 중 **접어 둔 것** — `ui_prefs.ecs.collapsedRosterGroups`(원장 2026-08-06
 * "학생 목록 / 퇴원생 목록 접기/펼치기").
 *
 * ⚠️ **한 카드가 아니라 시트 전체에 걸린다.** 교시 카드가 요일×교시로 수십 개인데 카드마다 따로 접으면
 *    같은 일을 수십 번 해야 하고, 나란한 카드의 로스터 높이가 어긋나 subgrid 줄맞춤(2026-08-04)이 깨진다.
 * ⚠️ 계정 귀속 — 브라우저(localStorage)에 두면 포트가 바뀔 때 조용히 리셋된다([[#90]]).
 * ⚠️ 이 값은 **표시뿐**이다 — 작성률 분모·일괄 입력 대상은 안 바꾼다(접어도 그 학생들은 그대로 대상).
 *    자리 토글과 결정적으로 다른 점이라 서버 재조회 없이 클라가 즉시 반영한다.
 */
export const DEFAULT_ECS_COLLAPSED_ROSTER_GROUPS: RosterGroupKey[] = [];
const ROSTER_GROUP_KEYS: RosterGroupKey[] = ["active", "withdrawn", "record"];

export function readEcsCollapsedRosterGroups(uiPrefs: unknown): RosterGroupKey[] {
  const raw = ecsScope(uiPrefs)?.collapsedRosterGroups;
  if (!Array.isArray(raw)) return DEFAULT_ECS_COLLAPSED_ROSTER_GROUPS;
  // 모르는 값은 버린다(통째로 무시하지 않는다) — 새 키가 생겨도 옛 선택이 살아남게.
  return ROSTER_GROUP_KEYS.filter((k) => raw.includes(k));
}

/** 저장 가능한 그룹 키만 남긴다(순서도 고정) — 액션·리더가 같은 정규화를 쓴다. */
export function normalizeCollapsedRosterGroups(raw: unknown): RosterGroupKey[] {
  if (!Array.isArray(raw)) return [];
  return ROSTER_GROUP_KEYS.filter((k) => raw.includes(k));
}

function ecsScope(uiPrefs: unknown): Record<string, unknown> | null {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return null;
  const scope = (uiPrefs as Record<string, unknown>).ecs;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  return scope as Record<string, unknown>;
}
