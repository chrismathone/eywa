/**
 * **연차 대상 역할** — 연차(부여·사용·잔여)가 있는 계정인가.
 *
 * - 학생 계정: 직원이 아니다(처음부터 제외).
 * - 아르바이트(`parttime`): 원장 2026-11-05 *"아르바이트생에게 연차 기능 필요없음. (역할이 아르바이트)"*.
 *
 * 🔑 판정은 **역할 하나**로 한다. 화면(내 정보 연차 카드)·관리 표(직원관리 > 연차)·조정 액션이 같은 함수를 지난다
 *    — 한 곳만 빼면 "내 정보엔 없는데 관리 표엔 있는" 사람이 생긴다.
 * ⚠️ DB 조회에 'parttime'을 넣지 않는다(그 열거형 값이 없는 DB에서 22P02로 조회 전체가 죽는다) — 관리 표는 학생만 SQL로 빼고 나머지는 이 함수로 거른다.
 */
import type { SystemRole } from "@/lib/permissions";

export const NON_LEAVE_ROLES = ["student", "parttime"] as const satisfies readonly SystemRole[];

export function isLeaveEligibleRole(role: SystemRole | string | null | undefined): boolean {
  if (!role) return false;
  return !(NON_LEAVE_ROLES as readonly string[]).includes(role);
}
