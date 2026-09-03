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
import { parseSheetLang, type SheetLang } from "./i18n";
import { normalizeEcsTeacher } from "./landing-teacher";
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

/**
 * `ui_prefs.ecs.teacher` → 랜딩의 **담임 보기 필터**(전체 / 담임별 / 담임 미지정, 2026-08-11).
 *
 * ⚠️ 프로그램 필터와 **곱해져** 걸린다(EiE만 보면서 그중 육소희 반만). 하나로 합치지 말 것.
 * ⚠️ 프로그램 필터와 마찬가지로 **작성률 분모를 바꾸지 않는다** — 목록을 눈으로 좁혀 보는 용도다.
 * ⚠️ 계정 귀속(원장 2026-08-04 *"모든 뷰 세팅은 계정에 귀속"*).
 * 🔴 저장값이 **지금 고를 수 있는 값인지**는 여기서 못 정한다(그 주의 반 목록을 알아야 한다) →
 *    [`resolveTeacherFilter`](./landing-teacher.ts)가 서버 쿼리에서 판정한다. 여기선 모양만 본다.
 */
export function readEcsTeacher(uiPrefs: unknown): string {
  return normalizeEcsTeacher(ecsScope(uiPrefs)?.teacher);
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
const ROSTER_GROUP_KEYS: RosterGroupKey[] = ["active", "makeup", "withdrawn", "record"];

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

/**
 * `ui_prefs.ecs.lang` → 이 사람이 **고른** 화면 언어(한국어/English, 2026-09-03).
 *
 * 🔴 다른 설정들과 달리 **기본값을 여기서 못 정한다** — 미설정 기본은 표시 이름에서 도출하는데
 *    (`defaultSheetLangFor`: 이름에 한글이 있으면 한국어) 이 함수는 이름을 모른다. 그래서 여기선
 *    "고른 값이 있나"만 답하고(없으면 null), 합치는 것은 [`resolveSheetLang`](./i18n.ts)이 한다.
 * ⚠️ 계정 귀속(원장 2026-08-04 *"모든 뷰 세팅은 계정에 귀속"*) — 원어민 강사가 학원 어느 PC에서 열어도
 *    영어로 열린다. localStorage면 포트가 바뀌는 순간 한글로 돌아간다([[#90]]).
 * ⚠️ 이 값은 **표시뿐**이다 — 작성률 분모·권한·저장되는 데이터를 한 글자도 바꾸지 않는다.
 */
export function readEcsLangPref(uiPrefs: unknown): SheetLang | null {
  return parseSheetLang(ecsScope(uiPrefs)?.lang);
}

/**
 * `ui_prefs.ecs.monthView` → 월간 뷰에서 마지막에 본 **보기**(달력 / 진도표, 2026-08-31).
 *
 * 기본은 **달력**(원장 2026-08-31 "처음열었을때 B뷰") — 강사가 더 자주 보는 화면이다. 진도표로 바꾸면
 * 그 선택이 계정에 남아, 담임·원장 화면은 다음에도 진도표로 열린다.
 * ⚠️ 계정 귀속(원장 2026-08-04 *"모든 뷰 세팅은 계정에 귀속"*) — 다른 PC에서도 같은 보기로 열린다.
 * ⚠️ 이 값은 **표현 방식만** 바꾼다 — 작성률 분모·경고 판정은 보기와 무관하게 같다(둘이 갈리면
 *    같은 달이 화면마다 다른 숫자를 말한다).
 * 🔴 `mp`(계획)는 **EiE 반에만 있는 보기**다(원장 2026-09-01 *"일단은 EiE 수업에만 적용될거고"*).
 *    저장값이 `mp`인 계정이 인재원 영어 반을 열 수도 있으므로, **화면이 열 때 한 번 더 좁힌다**
 *    (`clampEcsMonthView`) — 여기서 값 자체를 막지 않는 이유는 이 함수가 반을 모르기 때문이다.
 */
export type EcsMonthView = "cal" | "rail" | "mp";
export const DEFAULT_ECS_MONTH_VIEW: EcsMonthView = "cal";

export function readEcsMonthView(uiPrefs: unknown): EcsMonthView {
  return normalizeEcsMonthView(ecsScope(uiPrefs)?.monthView);
}

/** 모르는 값은 기본(달력) — 저장값이 깨졌다고 화면이 비면 안 된다. */
export function normalizeEcsMonthView(raw: unknown): EcsMonthView {
  return raw === "rail" || raw === "mp" ? raw : DEFAULT_ECS_MONTH_VIEW;
}

/**
 * 이 반에서 **실제로 열 수 있는 보기**로 좁힌다 — EiE가 아니면 계획(MP)은 없다.
 * 🔴 화면에서 탭만 숨기면 주소를 직접 치면 열린다(#77) → 서버 조회가 이 함수를 통과시킨다.
 */
export function clampEcsMonthView(view: EcsMonthView, isEie: boolean): EcsMonthView {
  return view === "mp" && !isEie ? DEFAULT_ECS_MONTH_VIEW : view;
}

/**
 * 월간 뷰의 **표시 토글**(과제 / 자리 교시)은 보기마다 따로 기억한다 — 달력은 하루가 완성돼야 해서
 * 둘 다 켠 채로, 진도표는 영역 줄에 반 진도와 개별 진도가 섞이면 흐름이 끊겨 둘 다 끈 채로 연다
 * (한 벌로 묶으면 한쪽에서 켠 것이 다른 쪽을 망친다 — 원장 시안 확인 2026-08-31).
 * 🔴 이 토글은 **표시만** 바꾼다. 작성률과 진도표 맨 아랫줄은 배정된 전 교시로 세므로 토글을 따라가지
 *    않는다 — 접는 것만으로 숫자가 좋아 보이면 계획을 안 쓴 자리 교시가 조용히 사라진다.
 *
 * `actual`(실제 함께 보기)은 **계획(MP) 보기에만** 있는 칸이다(기본 켬 — 대조가 그 보기의 존재
 * 이유라 끈 채로 열면 절반만 보인다). 달력·진도표는 이 값을 안 읽지만 같은 그릇에 담는다 — 토글
 * 저장 경로를 한 벌로 두려는 것이고, 보기별로 나뉘어 있어 서로 간섭하지 않는다.
 * ⚠️ 신호(미작성·교재 다름) 집계는 이 토글을 따라가지 않는다 — 접는 것으로 숫자가 좋아 보이면 안 된다.
 */
export type EcsMonthDisplay = { homework: boolean; seat: boolean; actual: boolean };
export const DEFAULT_ECS_MONTH_DISPLAY: Record<EcsMonthView, EcsMonthDisplay> = {
  cal: { homework: true, seat: true, actual: true },
  rail: { homework: false, seat: false, actual: true },
  mp: { homework: false, seat: false, actual: true },
};

export function readEcsMonthDisplay(uiPrefs: unknown, view: EcsMonthView): EcsMonthDisplay {
  const raw = ecsScope(uiPrefs)?.monthDisplay;
  const fallback = DEFAULT_ECS_MONTH_DISPLAY[view];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const scoped = (raw as Record<string, unknown>)[view];
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) return fallback;
  const rec = scoped as Record<string, unknown>;
  return {
    homework: typeof rec.homework === "boolean" ? rec.homework : fallback.homework,
    seat: typeof rec.seat === "boolean" ? rec.seat : fallback.seat,
    actual: typeof rec.actual === "boolean" ? rec.actual : fallback.actual,
  };
}

function ecsScope(uiPrefs: unknown): Record<string, unknown> | null {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return null;
  const scope = (uiPrefs as Record<string, unknown>).ecs;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  return scope as Record<string, unknown>;
}
