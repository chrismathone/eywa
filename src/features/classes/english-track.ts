/**
 * 영어 반 프로그램 구분 **단일소스** (순수 · Vitest) — 0176a `classes.english_track`.
 *
 * 원장 2026-08-04: *"상단 헤더에 (전체/EiE/인재원 영어) 토글버튼 만들고 on/off 할 수 있게. EiE 수업이라는건
 * 상단의 약자들 수업의 경우를 전부 EiE 수업이라고함. 영어과목으로 수업생성할때 EiE/인재원 영어 토글 가능하도록."*
 *
 * 약자(DP·PL·RTT·LT·LS·LE·KW·PJ·JP·MEC)는 EiE 프랜차이즈 레벨 이름의 머리글자다 — 풀네임은 청구 항목
 * 원문(`invoices.line_items`의 `[EiE]` 태그)에 남아 있었다: Dr.Phonics · Pre Let's · Ready To Talk ·
 * Let's Talk · Let's Speak · Let's Express · Kopi Wang · Pre Junior · Junior Plus · Middle School English Course.
 *
 * 🔴 **이름으로 판정하지 않는다.** 백필(0176a)만 이름 모양으로 한 번 갈랐고, 그 뒤 진실은 컬럼뿐이다.
 *    이름을 근거로 삼으면 반 이름을 고치는 순간 분류가 조용히 뒤집힌다([`report-optout.ts`](./report-optout.ts)가
 *    같은 이유로 이름 폴백을 거부한 선례). 이 파일에 이름 규칙을 다시 들이지 말 것.
 *
 * 🔴 **필터의 비대칭이 의도다** — EiE는 정확히 일치, 인재원 영어는 **"EiE가 아닌 전부"**(미분류 null 포함).
 *    양쪽을 정확히 일치로 거르면 미분류 반이 **두 필터 모두에서 사라진다**. 잘못된 칸에 보이는 건 눈에 띄어
 *    고쳐지지만 사라진 건 아무도 모른다(이 프로젝트가 반복해 밟은 "쓴 게 안 보임").
 *
 * ⚠️ 이 파일의 필터는 권한·집계를 바꾸지 않는다. 수납에서는 별도로 명시된 트랙을 읽어
 *    EiE 월 정액을 판정한다(billing/session-pricing.ts, 2026-09-16).
 */

/** DB에 저장되는 값. null = 미분류(비영어 반 포함). */
export type EnglishTrack = "eie" | "injaewon";

/** 화면 표시용 라벨 — raw 코드('eie') 노출 금지 규칙의 단일 출처. */
export const ENGLISH_TRACK_LABEL: Record<EnglishTrack, string> = {
  eie: "EiE",
  injaewon: "인재원 영어",
};

/** 폼 선택지 순서(EiE 먼저 — 약자 반이 이 토글을 쓰는 주 대상). */
export const ENGLISH_TRACK_OPTIONS: { value: EnglishTrack; label: string }[] = [
  { value: "eie", label: ENGLISH_TRACK_LABEL.eie },
  { value: "injaewon", label: ENGLISH_TRACK_LABEL.injaewon },
];

/**
 * 새 영어 반의 기본 선택 = 인재원 영어.
 * 미분류(null)가 필터에서 인재원 쪽에 보이므로, 기본값을 같은 쪽에 두면 **저장 전후로 보이는 자리가 안 바뀐다**.
 */
export const DEFAULT_ENGLISH_TRACK: EnglishTrack = "injaewon";

/**
 * EiE 구분을 쓸 수 없는 지점에서 조작한 폼이 `englishTrack=eie`를 보내도 서버가 돌려줄 사유.
 * 꺼진 기능의 이름은 일반 지점 화면에 드러내지 않는다.
 */
export const EIE_TRACK_UNAVAILABLE_MESSAGE = "현재 사용할 수 없는 반 구분입니다";

/**
 * 새 EiE 반이 생기는 쓰기만 막는다.
 *
 * - 새 반·다른 구분 → EiE: 모듈이 꺼져 있으면 거절.
 * - 이미 EiE인 반 → EiE: 다른 칸을 고치는 값 보존 요청이므로 허용.
 * - 모듈이 켜진 지점(침산): 종전처럼 모두 허용.
 *
 * `previous`를 읽지 못한 요청은 기존 EiE라고 증명할 수 없으므로 새 지정과 같이 막힌다.
 */
export function eieTrackWriteError(
  eieEnabled: boolean,
  next: EnglishTrack | null,
  previous?: EnglishTrack | null,
): string | null {
  return !eieEnabled && next === "eie" && previous !== "eie"
    ? EIE_TRACK_UNAVAILABLE_MESSAGE
    : null;
}

/** 보기 필터 값(계정 설정에 저장). */
export type EnglishTrackFilter = "all" | EnglishTrack;
export const ENGLISH_TRACK_FILTERS: EnglishTrackFilter[] = ["all", "eie", "injaewon"];
export const ENGLISH_TRACK_FILTER_LABEL: Record<EnglishTrackFilter, string> = {
  all: "전체",
  eie: ENGLISH_TRACK_LABEL.eie,
  injaewon: ENGLISH_TRACK_LABEL.injaewon,
};

/** 저장값 정규화 — 모르는 값은 null(미분류)로. DB snake_case와 앱 camelCase 둘 다 받는다. */
export function readEnglishTrack(input: {
  englishTrack?: string | null;
  english_track?: string | null;
}): EnglishTrack | null {
  const raw = input.englishTrack ?? input.english_track ?? null;
  return raw === "eie" || raw === "injaewon" ? raw : null;
}

/** 폼·액션 입력 정규화 — 영어 반이 아니면 항상 null(다른 과목에 트랙 개념이 없다). */
export function normalizeEnglishTrack(subject: string, raw: unknown): EnglishTrack | null {
  if (subject !== "english") return null;
  return raw === "eie" || raw === "injaewon" ? raw : null;
}

/** 필터 값 정규화 — 저장값이 깨져도 목록이 통째로 비지 않게 'all'로 떨어진다. */
export function normalizeEnglishTrackFilter(raw: unknown): EnglishTrackFilter {
  return raw === "eie" || raw === "injaewon" ? raw : "all";
}

/**
 * 이 반이 필터에 걸리는가. **비대칭 주의**(위 🔴): `injaewon`은 "EiE가 아닌 전부"라 미분류도 통과한다.
 */
export function matchesEnglishTrackFilter(
  row: { englishTrack?: string | null; english_track?: string | null },
  filter: EnglishTrackFilter,
): boolean {
  if (filter === "all") return true;
  const track = readEnglishTrack(row);
  return filter === "eie" ? track === "eie" : track !== "eie";
}

/** 목록 필터의 표준 술어. */
export function keepEnglishTrack<T extends { englishTrack?: string | null; english_track?: string | null }>(
  rows: readonly T[],
  filter: EnglishTrackFilter,
): T[] {
  return filter === "all" ? [...rows] : rows.filter((r) => matchesEnglishTrackFilter(r, filter));
}
