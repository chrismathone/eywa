import type { PillColor } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import type { ClassSort, ClassStatusFilter } from "./server/queries";
import { isSpecialLecture } from "./special-lecture";

/**
 * 수업목록 필터 어휘 — 서버 페이지(searchParams·저장값 해석)와 화면 조각이 공유하는 **순수 모듈**(디렉티브 없음).
 * 옛 `app/(shell)/classes/_components/filter-shared.ts`를 features로 옮긴 것(2026-09-03, 열 머리 필터 전환).
 * `ClassSort`는 타입만 import라 server-only 런타임 가드가 안 붙는다.
 */

export type ViewMode = "cards" | "table";

/**
 * 상태 필터 선택지 — 라벨은 목록의 상태 배지와 **같은 말**이어야 한다(배지는 `classStatusMeta`가 같은 표를 읽는다).
 * 기본값 `operating`(원장 2026-08-27 *"디폴트로 폐지나 종강된 수업은 안보이고"*).
 */
export const CLASS_STATUS_DEFAULT: ClassStatusFilter = "operating";
export type ClassStatusKey =
  | "cls.status.operating"
  | "cls.status.ended"
  | "cls.status.retired"
  | "cls.filter.all";
// 🔴 **문구는 사전 한 곳**(`teacher-view/i18n.ts`)이고 여기엔 키만 둔다 — 한국어도 그 사전에서 나온다
//    (`sheetT("ko", key)`). 코드와 사전 두 곳에 적으면 한쪽만 고쳐져 같은 상태가 화면마다 다른 말을 한다.
export const STATUS_FILTERS: { value: ClassStatusFilter; key: ClassStatusKey }[] = [
  { value: "operating", key: "cls.status.operating" },
  { value: "ended", key: "cls.status.ended" },
  { value: "retired", key: "cls.status.retired" },
  { value: "all", key: "cls.filter.all" },
];

/** URL·저장값 → 상태 필터(모르는 값은 기본값). 서버 페이지와 열 머리가 같은 판정을 쓰게 하는 단일 소스. */
export function parseClassStatus(raw: string | undefined | null): ClassStatusFilter {
  return STATUS_FILTERS.some((o) => o.value === raw)
    ? (raw as ClassStatusFilter)
    : CLASS_STATUS_DEFAULT;
}

/**
 * 반 한 줄의 상태 배지 — 라벨은 위 필터 표에서, 색은 의미색 캐논(팔레트 v4): 운영 = positive(green) · 종강 = caution(amber) ·
 * 폐지 = inert(neutral). 🔴 v4 전수 처리에서 이 화면만 빠져 '운영'이 brand(primary)로 남아 있었다(2026-09-03) — 재원·재직과
 * 같은 "정상"이라 초록이 맞다.
 */
export function classStatusMeta(c: { isActive: boolean; closedAt: string | null }): {
  key: ClassStatusKey;
  color: PillColor;
} {
  if (!c.isActive) return { key: keyOf("retired"), color: "neutral" };
  if (c.closedAt) return { key: keyOf("ended"), color: "amber" };
  return { key: keyOf("operating"), color: "green" };
}
function keyOf(v: ClassStatusFilter): ClassStatusKey {
  return STATUS_FILTERS.find((o) => o.value === v)?.key ?? "cls.filter.all";
}

/**
 * **구분(정규/특강)** — 원장 2026-09-18 *"[특강] [정규] [전체]를 구분할 수 있게 열 하나 더 … 과목 앞에"*.
 * 시간표 툴바의 `구분: 정규·특강·전체`와 같은 축이다(말도 같다). 다만 기본값이 다르다 — 시간표는 정규(특강을 주간표에서
 * 걸러 내려고), 수업목록은 **전체**(이 열이 생기기 전 목록이 전부였다; 기본을 바꾸면 특강 반이 조용히 사라진다).
 * 🔴 "이 반이 특강인가"는 여기서 새로 판정하지 않는다 — [`isSpecialLecture`](src/features/classes/special-lecture.ts)
 *    (토글 ∪ 이름 폴백) 한 벌을 목록 조회(`getClassesPage`)와 알약이 **같이** 부른다. 따로 적으면 `구분: 특강`으로 거른
 *    목록에 '정규' 알약이 서는 거짓이 난다.
 */
export type ClassKindFilter = "all" | "regular" | "special";
export type ClassKindKey = "cls.kind.regular" | "cls.kind.special";
export const CLASS_KIND_DEFAULT: ClassKindFilter = "all";
// 문구는 사전 한 곳(`cls.kind.*`) — 여기엔 값과 키만(위 상태 표와 같은 규약). '전체'는 열 머리의 allLabel이다.
export const KIND_FILTERS: { value: Exclude<ClassKindFilter, "all">; key: ClassKindKey }[] = [
  { value: "regular", key: "cls.kind.regular" },
  { value: "special", key: "cls.kind.special" },
];

/** URL·저장값 → 구분(모르는 값은 전체). */
export function parseClassKind(raw: unknown): ClassKindFilter {
  return raw === "regular" || raw === "special" ? raw : CLASS_KIND_DEFAULT;
}

/**
 * 반 한 줄의 구분 알약 — 특강 = 예외(special tone, 보라) · 정규 = 기본이라 색을 뺀다(inert). 정규에 색을 주면 한 열이
 * 전부 칠해져 정작 드문 특강이 안 보인다.
 */
export function classKindMeta(c: { isSpecial: boolean | null | undefined; className: string | null | undefined }): {
  kind: Exclude<ClassKindFilter, "all">;
  key: ClassKindKey;
  color: PillColor;
} {
  return isSpecialLecture({ isSpecial: c.isSpecial, className: c.className })
    ? { kind: "special", key: "cls.kind.special", color: TONE_COLOR.special }
    : { kind: "regular", key: "cls.kind.regular", color: TONE_COLOR.inert };
}

/** 이 반이 지금 구분 필터에 걸리는가 — 목록 조회가 쓰는 판정(알약과 같은 `classKindMeta`). */
export function matchesClassKind(
  kind: ClassKindFilter,
  c: { isSpecial: boolean | null | undefined; className: string | null | undefined },
): boolean {
  return kind === "all" || classKindMeta(c).kind === kind;
}

// 🔴 요일 **글자**는 여기 두지 않는다 — 화면 언어를 타야 해서 `sheetDowLabel(key, lang)`이 단일 소스다
//    (시트 툴바·수업목록 열 머리가 같은 함수를 쓴다). 여기 있는 건 순서와 키뿐이다.
export const DAY_FILTERS = [
  { key: "mon" },
  { key: "tue" },
  { key: "wed" },
  { key: "thu" },
  { key: "fri" },
  { key: "sat" },
  { key: "sun" },
];
export const DAY_KEYS = new Set(DAY_FILTERS.map((d) => d.key));

// 정렬 옵션 — 드롭다운에 전부 노출(기본 name 포함).
// 문구는 사전 한 곳(`cls.sort.*`) — 여기엔 값과 키만(위 상태 표와 같은 규약).
export const SORT_OPTIONS: { value: ClassSort; key: "cls.sort.name" | "cls.sort.students" | "cls.sort.teacher" }[] = [
  { value: "name", key: "cls.sort.name" },
  { value: "students", key: "cls.sort.students" },
  { value: "teacher", key: "cls.sort.teacher" },
];

/** 정렬 — 모르는 값은 기본(수업명순). URL·저장값 둘 다 이 한 곳을 지난다. */
export function parseClassSort(raw: unknown): ClassSort {
  return SORT_OPTIONS.some((o) => o.value === raw) ? (raw as ClassSort) : "name";
}

/** 보기(표/카드) — 모르는 값은 표. */
export function parseClassView(raw: unknown): ViewMode {
  return raw === "cards" ? "cards" : "table";
}

/** 강사가 해당 과목 담당인지 — users.subjects 대소문자 편차('MATH' vs 'math')에 견고(정확일치, 무시). */
export const teacherTeaches = (subjects: string[], subjectKey: string) =>
  subjects.some((s) => s.toLowerCase() === subjectKey.toLowerCase());
