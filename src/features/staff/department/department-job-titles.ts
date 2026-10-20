/**
 * 근무부서 → 직급 선택지(원장 지시 2026-07-29).
 *
 * 부서마다 직급 체계가 다르다(교과 = 분원장·부원장·교수부장·전임강사·파트강사·프리랜서 /
 * 경영지원팀 = 부장·과장·대리·사원 / 개발팀 = 연구소장… / 아르바이트 = 아르바이트 하나).
 * 목록 자체는 **학원설정(`operations.jobTitlesByDepartment`)이 단일 소스** — 여기 코드엔 값을 두지 않는다
 * (운영 enum 하드코딩 금지). 이 모듈은 "어느 목록을 쓸지"와 "자동 확정인지"만 판정한다.
 */

/** 그 부서의 직급 선택지. 부서 전용 목록이 없으면 공통 직급(`operations.jobTitles`)으로 폴백. */
export function jobTitlesForDepartment(
  department: string | null | undefined,
  byDepartment: Record<string, string[]> | undefined | null,
  fallback: readonly string[] = [],
): string[] {
  const key = (department ?? "").trim();
  const own = key ? byDepartment?.[key] : undefined;
  const cleaned = (own ?? []).map((t) => t.trim()).filter(Boolean);
  if (cleaned.length > 0) return dedupe(cleaned);
  return dedupe(fallback.map((t) => t.trim()).filter(Boolean));
}

/**
 * 선택지가 **하나뿐이면** 그 직급으로 자동 확정한다(아르바이트 부서 = 직급 '아르바이트').
 * 고를 게 없는데 고르라고 시키지 않는다 — 부서를 고르는 순간 직급이 채워진다.
 */
export function autoJobTitle(options: readonly string[]): string | null {
  return options.length === 1 ? options[0] : null;
}

const dedupe = (arr: string[]): string[] => [...new Set(arr)];
