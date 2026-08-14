/**
 * 직급 서열 정렬 — 결재선 지정 팝업의 직원 목록 순서(원장 2026-08-14: *"결재라인 드롭다운은 직급
 * 기준으로 정렬해줘"*). 순수 함수(Vitest).
 *
 * 🔑 서열의 단일 소스는 **학원설정 `operations.jobTitles`의 배열 순서**다(운영 enum 하드코딩 금지 규칙).
 *    실측 설정: 원장 → 부원장 → 실장 → 강사 → 조교 → 행정 → 아르바이트.
 *
 * ⚠️ 실제 직급명은 변형이 많다("수학과 부원장"·"급여제 강사"·"LAP실 아르바이트") — 정확일치로는
 *    대부분 놓친다 → **포함(substring) 매칭**하되, "수학과 부원장"이 '원장'(0위)으로 잡히지 않게
 *    **매칭된 설정 직급 중 가장 긴 것**을 취한다('부원장'이 '원장'을 이긴다).
 * ⚠️ 설정에 없는 직급·빈 직급은 맨 뒤(서열을 지어내지 않는다 — 같은 꼬리 안에서는 이름순).
 */

/** jobTitle의 서열 순위 — 낮을수록 높은 직급. 못 찾으면 Infinity(맨 뒤). */
export function jobTitleRank(jobTitle: string | null | undefined, orderedTitles: readonly string[]): number {
  const t = (jobTitle ?? "").trim();
  if (!t) return Infinity;
  let best = Infinity;
  let bestLen = 0;
  for (let i = 0; i < orderedTitles.length; i += 1) {
    const title = orderedTitles[i]!;
    if (!title || !t.includes(title)) continue;
    if (title.length > bestLen) {
      best = i;
      bestLen = title.length;
    }
  }
  return best;
}

/** 직급 서열 → 같은 서열은 이름순(한국어) — 결재선 후보 목록의 정렬 규칙 한 곳. */
export function compareByJobRank(
  a: { name: string; jobTitle: string | null },
  b: { name: string; jobTitle: string | null },
  orderedTitles: readonly string[],
): number {
  const ra = jobTitleRank(a.jobTitle, orderedTitles);
  const rb = jobTitleRank(b.jobTitle, orderedTitles);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, "ko");
}
