/**
 * 근무부서 → 담당 과목 자동 도출.
 *
 * 부서와 과목은 사실상 같은 축인데(영어과=영어, 수학과=수학) 이력서(부서)와 직원 수정 폼(담당 과목)에서
 * 두 번 입력해야 했다(원장 지적 2026-07-29). 부서를 단일 소스로 삼고 과목은 여기서 파생한다.
 *
 * 매칭은 **학원설정 과목 라벨 포함 여부**만 본다 — 과목 목록을 코드에 박지 않기 위함(운영 enum 하드코딩 금지).
 *   '영어과' → english · '국어과' → korean · '수학/과학과' → math·science
 *   'EIE'·'경영지원팀'·'개발팀'·'아르바이트' → [] (담당 과목 없이 쓴다)
 */

/** 1글자 라벨은 우연 일치(예: 부서명 속 한 글자)가 잦아 매칭에서 제외한다. */
const MIN_LABEL_LEN = 2;

export type SubjectOption = { value: string; label: string };

/**
 * 부서명에 이름이 들어간 과목들의 key. 설정 순서를 따르고 중복은 제거한다.
 * 부서가 비었거나 어떤 과목명도 안 들어가면 빈 배열(= 담당 과목 없음).
 */
export function subjectsFromDepartment(
  department: string | null | undefined,
  options: readonly SubjectOption[],
): string[] {
  const dept = (department ?? "").trim();
  if (!dept) return [];
  const keys: string[] = [];
  for (const o of options) {
    const label = (o.label ?? "").trim();
    if (label.length < MIN_LABEL_LEN) continue;
    if (!dept.includes(label)) continue;
    if (!keys.includes(o.value)) keys.push(o.value);
  }
  return keys;
}
