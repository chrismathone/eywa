/**
 * 원생 보호자 칸의 규칙 한 벌 — 원생 폼(화면)과 저장(`server/actions.ts` 검증)이 같은 값을 본다(원장 2026-11-04 보호자2).
 */

/** 보호자 관계 선택지 — 보호자1·보호자2가 같은 목록. 값이 곧 저장값이다. */
export const GUARDIAN_RELATIONS = ["부", "모", "조부", "조모", "기타"] as const;

/** 보호자2 이름 길이 상한 — 서버가 거절하고 입력칸도 같은 길이로 막는다. */
export const GUARDIAN2_NAME_MAX = 50;

export function isGuardianRelation(value: string): boolean {
  return (GUARDIAN_RELATIONS as readonly string[]).includes(value);
}
