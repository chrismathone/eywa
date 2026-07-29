// ECS 계획 행 텍스트 codec + '의미 있는 행' 판정 — 순수(Vitest).
// ⚠️ isMeaningfulPlanLine은 0155a SQL `ecs_is_meaningful_line`과 **동일 정의**여야 한다(복사 skip 판정이
//    앱·RPC 양쪽에서 같은 답을 내야 함). 한쪽만 고치지 말 것 — Vitest가 픽스처 동치를 잠근다.

/** 계획 행에서 patch(CAS)로 편집 가능한 컬럼 — 런타임 allowlist(그 외 필드는 액션이 즉시 거부). */
export const PLAN_PATCH_FIELDS = [
  "skill_area",
  "textbook",
  "page_range",
  "progress",
  "homework",
] as const;
export type PlanPatchField = (typeof PLAN_PATCH_FIELDS)[number];

export function isPlanPatchField(field: string): field is PlanPatchField {
  return (PLAN_PATCH_FIELDS as readonly string[]).includes(field);
}

/**
 * NULL/빈 문자열 공용 codec — 저장 전 trim, 빈 문자열은 NULL로 단일화.
 * CAS의 expectedValue 비교가 "" vs null로 갈리지 않게 클라·서버가 모두 이 함수를 거친다.
 */
export function normalizePlanText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type PlanLineTexts = {
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

/**
 * '의미 있는 행' = trim 후 textbook/page_range/progress/homework 중 1개 이상 비어있지 않음.
 * 구조 필드(term_mode/skill_area/line_no)는 제외 — 영역만 고른 빈 줄(placeholder)은 작성으로 안 친다.
 * (SQL 미러: ecs_is_meaningful_line — nullif(btrim(coalesce(x,'')),'') is not null OR …)
 */
export function isMeaningfulPlanLine(line: PlanLineTexts): boolean {
  return (
    normalizePlanText(line.textbook) !== null ||
    normalizePlanText(line.pageRange) !== null ||
    normalizePlanText(line.progress) !== null ||
    normalizePlanText(line.homework) !== null
  );
}
