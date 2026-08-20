/**
 * 오늘 출결(`/attendance/live`) 보기 설정 — 계정 귀속(`users.ui_prefs.attendanceLive`).
 *
 * 원장 2026-08-20: *"오늘의 출결에서 과목별 필터링 되도록"* + 상시 지시 *"모든 뷰 세팅은 계정 귀속"*
 * (2026-08-04). localStorage는 **포트까지 포함한 origin 단위**라 "로그인은 그대로인데 설정만 리셋"으로
 * 위장하고, 다른 PC에서 열면 남의 화면처럼 보인다([[#90]]).
 *
 * 🔴 **학생 검색과 다른 물건이다.** 검색은 휘발(`useState`, 저장 없음 — 다음에 열었을 때 걸려 있으면
 *    "오늘 수업이 하나뿐"으로 읽힌다)이고, 과목 필터는 오래 남는 뷰 세팅이라 계정에 저장한다.
 * 🔴 과목 키는 **학원설정이 단일 소스**다(`useSubjectMaps().filters`). 여기에 과목 목록을 적지 말 것 —
 *    저장된 값이 지금 설정에 없으면 화면이 '전체'로 되돌린다(아래 `resolveSubjectFilter`).
 * ⚠️ 일반 모듈이어야 한다 — 서버(초기값)와 클라(칩)가 같이 쓴다. `import "server-only"`를 붙이면
 *    클라 번들에서 런타임 undefined가 되고 타입체크는 통과한다([[#61]]·[[#81]]).
 * ⚠️ 파서 규약은 [`view-prefs.ts`](../view-prefs.ts)와 같다 — **필드마다 독립으로 흡수**하고 모르는 값은
 *    버린다(한 필드가 깨졌다고 통째로 기본값을 돌려주면 다른 설정이 조용히 사라진다).
 */

/** '전체'(필터 없음) — `buildSubjectMaps(...).filters`의 첫 칸과 같은 값이다. */
export const SUBJECT_FILTER_ALL = "all";

/** 저장된 값의 길이 상한 — 손장난·오염된 값이 그대로 들어오지 않게. */
const MAX_KEY_LEN = 64;

export type LiveViewPrefs = {
  /** 과목 필터. `all`이면 안 좁힌다. 학원설정의 과목 키 하나가 들어온다. */
  subject: string;
};

export const DEFAULT_LIVE_PREFS: LiveViewPrefs = { subject: SUBJECT_FILTER_ALL };

export function parseSubjectFilter(raw: unknown): string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_KEY_LEN
    ? raw
    : SUBJECT_FILTER_ALL;
}

export function parseLiveViewPrefs(raw: unknown): LiveViewPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { subject: parseSubjectFilter(o.subject) };
}

/**
 * 저장된 값이 **지금 설정에 있는 과목인가** — 없으면 '전체'로 되돌린다.
 *
 * 🔑 과목은 학원설정에서 지워지거나 다른 과목에 흡수될 수 있다(`absorbSubject`). 그때 저장된 키를 그대로
 *    쓰면 아무 반도 안 걸려 **빈 화면**이 되고, 사용자는 "출결이 사라졌다"로 읽는다.
 */
export function resolveSubjectFilter(
  saved: string,
  available: readonly { value: string }[],
): string {
  if (saved === SUBJECT_FILTER_ALL) return SUBJECT_FILTER_ALL;
  return available.some((f) => f.value === saved) ? saved : SUBJECT_FILTER_ALL;
}

/**
 * 이 줄이 지금 필터에 걸리나 — '전체'면 **항상 참**이다.
 * 🔴 필터가 없을 때 아무 줄도 안 그리는 사고를 구조적으로 막는다(학생 검색 `matchesStudentSearch`와 같은 결).
 */
export function matchesSubjectFilter(filter: string, subject: string | null | undefined): boolean {
  if (filter === SUBJECT_FILTER_ALL) return true;
  return (subject ?? "") === filter;
}

/** 필터가 걸려 있나 — 화면이 "지금 좁혀 보고 있다"를 밝힐지 판단하는 값. */
export function isSubjectFilterActive(filter: string): boolean {
  return filter !== SUBJECT_FILTER_ALL;
}
