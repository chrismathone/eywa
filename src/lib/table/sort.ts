/**
 * 표 정렬 공용 규약(순수, Vitest) — 헤더를 눌러 가나다·숫자·날짜순으로 정렬한다.
 *
 * ⚠️ **한글 정렬은 브라우저 `localeCompare("ko")` 단일 소스**로 통일한다. DB(Postgres) 정렬과 섞지 말 것 —
 * ICU ko는 한글 우선, PG 기본 콜레이션은 로마자 우선이라 같은 목록이 화면과 서버에서 다른 순서로 나온다
 * (이미 한 번 되돌린 이력: [[project_sort-bias-category-starvation]]). 화면 정렬은 전부 클라에서 한다.
 *
 * ⚠️ 정렬은 **안정(stable)** 이어야 한다 — 같은 값끼리는 원래 순서(대개 반·교시 순)를 지켜야 목록이
 * 눌렀다 뗄 때마다 요동치지 않는다. Array.prototype.sort는 안정 정렬이라 그대로 쓰되, 비교 결과 0을
 * 반환하는 경로를 반드시 남긴다(임의 tie-break 금지).
 */

export type SortDir = "asc" | "desc";
/** null = 정렬 안 함(원래 순서 유지). */
export type SortState<K extends string = string> = { key: K; dir: SortDir } | null;

/** 정렬에 쓰는 셀 값 — 문자열/숫자/없음. 없음은 방향과 무관하게 **항상 뒤**로 보낸다. */
export type SortValue = string | number | null | undefined;

/** 한글·영문 혼재 목록의 표준 비교. 숫자가 섞인 이름("중3 CR3D")은 자연 정렬(numeric). */
export function compareKo(a: string, b: string): number {
  return a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" });
}

/** 값 하나 비교(오름차순 기준). 빈 값은 항상 뒤. */
export function compareValues(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // 빈 값은 뒤로
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return compareKo(String(a), String(b));
}

/**
 * 헤더 클릭 → 다음 상태. 같은 열이면 오름 → 내림 → 해제(원래 순서)로 3단 순환한다.
 * ⚠️ 3단째에 **해제**가 있어야 "정렬 전 순서(반·교시 정렬)"로 돌아갈 길이 생긴다 — 없으면 한 번 누른 뒤
 * 영영 원래 순서를 못 본다.
 */
export function toggleSort<K extends string>(prev: SortState<K>, key: K): SortState<K> {
  if (!prev || prev.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

/**
 * 정렬 적용. `state`가 null이면 **원본 배열을 그대로** 돌려준다(복사도 안 함 — 참조 동일성 유지).
 * `valueOf`는 행+열키 → 비교값. 빈 값은 방향과 무관하게 뒤로 간다.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  state: SortState<K>,
  valueOf: (row: T, key: K) => SortValue,
): readonly T[] {
  if (!state) return rows;
  const sign = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = valueOf(x, state.key);
    const b = valueOf(y, state.key);
    const aEmpty = a === null || a === undefined || a === "";
    const bEmpty = b === null || b === undefined || b === "";
    // 빈 값은 내림차순에서도 뒤 — "값 없음"이 맨 위로 올라오면 목록이 쓸모없어진다.
    if (aEmpty || bEmpty) return compareValues(a, b);
    return sign * compareValues(a, b);
  });
}

/**
 * 헤더에 붙일 방향(정렬 중인 열만, 아니면 null). 스크린리더용 aria-sort 값과 짝.
 * ⚠️ 여기서 "▲" 같은 **문자 글리프를 돌려주지 말 것** — 아이콘 자리에 텍스트 기호를 쓰는 건 리포 금지
 * 규칙이고 `aywa-icon-mapping` 테스트가 잡는다. 방향만 주고 그림은 헤더가 EyIcon으로 그린다.
 */
export function sortIndicator(state: SortState, key: string): SortDir | null {
  if (!state || state.key !== key) return null;
  return state.dir;
}

export function ariaSort(state: SortState, key: string): "ascending" | "descending" | "none" {
  if (!state || state.key !== key) return "none";
  return state.dir === "asc" ? "ascending" : "descending";
}
