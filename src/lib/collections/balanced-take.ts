/**
 * 카테고리별 라운드로빈으로 상위 N개를 고른다 — "정렬 편향 × 상위 N 자르기"로 한 카테고리가
 * 통째로 사라지는 것을 막는다(gotcha #84).
 *
 * 배경: 목록을 그냥 `slice(0, N)` 하면 정렬 키가 카테고리와 상관돼 있을 때 한쪽이 전멸한다.
 * 실제 사례 — 반 목록은 이름 오름차순인데 영어반은 로마자 코드(DP5·JP1), 수학반은 한글(고등M·개별)이라
 * 정렬 앞부분이 통째로 영어반이었다. 상위 25개 = 영어 22 : 수학 3, 상위 8개 = 영어 8 : 수학 0.
 *
 * 고정 쿼터(카테고리마다 N/k개)와 달리 **라운드로빈은 남는 몫을 다른 카테고리가 흡수**한다:
 * 카테고리가 3개여도 그중 둘이 1개씩뿐이면 나머지 하나가 N-2개를 가져간다(빈 슬롯 낭비 없음).
 *
 * - 그룹 순서·그룹 내 순서는 **입력 순서를 보존**한다(정렬하지 않는다 — 재정렬은 같은 편향을 다시 만든다).
 * - 반환 순서는 그룹별로 묶여 나온다(그룹 A의 선발분 → 그룹 B의 선발분 …).
 */
export function balancedTake<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  limit: number,
): T[] {
  if (limit <= 0 || items.length === 0) return [];
  if (items.length <= limit) return [...items];

  // 첫 등장 순서를 유지하며 그룹핑(Map은 삽입 순서 보존).
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }

  const buckets = [...groups.values()];
  const picked = buckets.map<T[]>(() => []);
  let taken = 0;
  // 라운드마다 각 그룹에서 1개씩. 소진된 그룹은 자연히 건너뛰므로 남은 몫이 다른 그룹으로 흘러간다.
  for (let round = 0; taken < limit; round++) {
    let progressed = false;
    for (let g = 0; g < buckets.length && taken < limit; g++) {
      const item = buckets[g]![round];
      if (item === undefined) continue;
      picked[g]!.push(item);
      taken++;
      progressed = true;
    }
    if (!progressed) break; // 모든 그룹 소진(items.length < limit인 경우 — 위에서 걸러지지만 방어)
  }
  return picked.flat();
}

/** 카테고리별 선발 개수 — "각 카테고리에서 몇 개 보여줬나"를 호출부가 안내에 쓸 때. */
export function takenPerKey<T>(picked: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of picked) {
    const k = keyOf(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
