// ECS 계획 행 텍스트 codec + '의미 있는 행' 판정 — 순수(Vitest).
// ⚠️ isMeaningfulPlanLine은 0157a SQL `ecs_is_meaningful_line`과 **동일 정의**여야 한다(복사 skip 판정이
//    앱·RPC 양쪽에서 같은 답을 내야 함). 한쪽만 고치지 말 것 — Vitest가 픽스처 동치를 잠근다.

/**
 * 계획 행 '구분'(skill_area) 슬러그 — 학원설정 `subjects[].skillAreas[].key`와 같은 모양이고
 * DB check 제약(`skill_area ~ '^[a-z0-9_]{1,24}$'`, 0157a)의 앱쪽 거울이다.
 * 🔴 쓰기 경로가 둘(로그인 ECS·공개 PIN)이라 **여기 한 곳**에서만 정의한다 — 한쪽만 느슨해지면
 *    그쪽으로 제약 밖 값이 들어와 DB가 거절하는 저장이 생긴다.
 */
export const SKILL_AREA_SLUG_RE = /^[a-z0-9_]{1,24}$/;

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
