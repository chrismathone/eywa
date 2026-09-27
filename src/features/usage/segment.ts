/**
 * 이용 분석의 **사용자 분류**(segment) — 권한, 그리고 강사는 과목별(원장 2026-09-28 *"과목별 강사 분류를 따로해"*).
 * 순수 함수(Vitest) · 서버·클라 공용 일반 모듈([[#61]]·[[#81]]).
 *
 * 과목 묶음 모양은 DB 함수 `usage_subject_group`(0293a)이 정한다: 한 과목 = 키(`math`) · 여럿 = 정렬해 `+`로 이은 키
 * (`english+math`, 겸업) · 없음 = ''. 🔴 라벨은 **학원설정 과목**(`buildSubjectMaps().labelOf`)으로 — 과목 이름을 코드에 적지 않는다.
 */

/** 과목 필터의 특수값 — 과목 키(영소문자·숫자·밑줄)와 겹치지 않는 글자. */
export const SUBJECT_MULTI = "+";
export const SUBJECT_NONE = "-";

const GROUP = /^[a-z][a-z0-9_]{0,39}(?:\+[a-z][a-z0-9_]{0,39}){0,7}$/;

/** 주소에서 받은 과목 필터 값 — 겸업·미지정·과목 묶음만. */
export function isSubjectFilter(v: string): boolean {
  return v === SUBJECT_MULTI || v === SUBJECT_NONE || GROUP.test(v);
}

/** 권한 + 과목 묶음 → 분류 키. 강사만 과목으로 가른다. 과목 칸이 없는 옛 스키마(null)면 강사 한 묶음. */
export function usageSegmentKey(role: string, subjectGroup: string | null): string {
  return role === "teacher" && subjectGroup !== null ? `teacher:${subjectGroup}` : role;
}

/** 분류 키 → (권한, 과목 필터 값). 강사 과목 묶음이 아니면 subject는 null. */
export function splitSegmentKey(key: string): { role: string; subject: string | null } {
  if (!key.startsWith("teacher:")) return { role: key, subject: null };
  const group = key.slice("teacher:".length);
  return { role: "teacher", subject: group === "" ? SUBJECT_NONE : group };
}

/** 과목 묶음 → "수학" · "수학+영어" · "과목 미지정" · "겸업". */
export function subjectGroupLabel(group: string, labelOf: (key: string) => string): string {
  if (group === SUBJECT_MULTI) return "겸업(과목 둘 이상)";
  if (group === "" || group === SUBJECT_NONE) return "과목 미지정";
  return group.split("+").map(labelOf).join("+");
}
