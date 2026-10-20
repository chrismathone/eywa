// 계약구분(`users.employment_type`) 판정 — 값은 이력서가 단일 소스(`EMPLOYMENT_TYPES`, 저장 때 users로 옮겨 적는다).
// 클라/서버 공용 — server-only 금지 [[#61]].
//
// '혼합' = 근로계약 + 강의용역계약(원장 2026-10-16 이성우 선생님 *"프리랜서가 아님. 특수 계약. 초중은 급여 고등은 프리"* →
// *"반반 계약을 따로 표기하는 칸 추가가 근본적이겠다"*). 두 몫을 이렇게 가른다:
//  · 용역 몫 = 출석부 '비율 설정'의 대상 학년 — 프리랜서처럼 출석부 실급여·프리랜서 명세서·강사 정산 면을 탄다(그 학년 학생만).
//  · 근로 몫 = 근로 요일(같은 비율표의 `workDays`) — 강사평가 근태는 이 요일만 센다(나머지 요일은 프리랜서처럼 세지 않는다).
//  · 강사평가 '매출 대비 급여' = 계약서 월급 + 출석부 실급여(둘 중 하나라도 모르면 비율을 내지 않는다).
import { WORKDAYS } from "./resume/resume";

export const MIXED_EMPLOYMENT = "혼합";

/** 출석부 실급여·프리랜서 명세서를 타는 계약 — 프리랜서 · 혼합(용역 학년만). 🔴 `=== "프리랜서"`를 새로 적지 말고 이것을 쓴다. */
export function hasFreelancePart(type: string | null | undefined): boolean {
  return type === "프리랜서" || type === MIXED_EMPLOYMENT;
}

export const isMixedEmployment = (type: string | null | undefined): boolean => type === MIXED_EMPLOYMENT;

export type WorkDay = (typeof WORKDAYS)[number]["key"];
const ORDER: readonly string[] = WORKDAYS.map((d) => d.key);

/**
 * 근로 요일 정리 — 아는 요일만 월→일 순서로, 겹침 없이. 빈 목록은 `[]`(정하지 않음).
 * 배열이 아니거나 모르는 값이 섞이면 null(저장 거절 — 조용히 버리면 고른 요일이 사라진다).
 */
export function parseWorkDays(value: unknown): WorkDay[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((d) => typeof d !== "string" || !ORDER.includes(d))) return null;
  return ORDER.filter((d) => value.includes(d)) as WorkDay[];
}

/** `["mon","tue"]` → `월·화`(표시 전용). */
export function workDaysLabel(days: readonly string[] | null | undefined): string {
  return WORKDAYS.filter((d) => days?.includes(d.key)).map((d) => d.label).join("·");
}
