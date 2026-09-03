/**
 * 표 정렬 — 순수. 전 열 정렬 가능(시안 `◆`). null은 항상 뒤(오름/내림 무관 — "모르는 값"이 맨 위로
 * 올라오면 정렬이 무의미해진다). 문자열은 한국어 로케일, 숫자는 수치 비교.
 */
export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function compareSortValues(a: SortValue, b: SortValue): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** 같은 열을 다시 누르면 방향 토글, 다른 열이면 오름차순부터. */
export function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : { key, dir: "asc" };
}

/**
 * 정렬 적용 — 원본 배열을 바꾸지 않는다. 정렬 상태가 없으면 입력 순서(=`sort_order`) 그대로.
 * 동률은 입력 순서 유지(안정 정렬 — `Array.prototype.sort`는 ES2019부터 안정). null은 방향과 무관하게 뒤.
 */
export function sortRows<T>(rows: ReadonlyArray<T>, sort: SortState, valueOf: (row: T, key: string) => SortValue): T[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    const an = va === null || va === undefined || va === "";
    const bn = vb === null || vb === undefined || vb === "";
    if (an || bn) return compareSortValues(va, vb);
    return sign * compareSortValues(va, vb);
  });
}
