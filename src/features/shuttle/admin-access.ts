import { canAccess, type AccessMatrix, type SystemRole } from "@/lib/permissions";

/**
 * 셔틀 **관리자 화면**을 열 수 있는가 — 학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치(원장 2026-11-10 결정).
 * = 운영 계정 · 또는 **셔틀 권한**(`shuttle`)과 **'셔틀 관리자 화면' 권한**(`shuttle_admin`)이 둘 다 열린 사람. 셔틀 권한 위에 덧붙는 조건이다.
 * 기본값은 원장·관리자 '전체'(종전 코드의 역할 판정과 같다 — 원장 *"기존 동작 유지"*). 원장이 역할·권한 표나 개인별 메뉴 권한으로 바꾼다
 * (원장·관리자 칸만 — 학부모 계정 DB 정책 0320a가 그 두 역할에게만 읽기를 연다, `SHUTTLE_ADMIN_ROLES`).
 * 🔴 화면 입구(메뉴 판 · 검색 · 셔틀 탭 줄)와 서버 문(페이지 · 서버 액션 · 조회)이 **이 함수 하나**를 지난다([[#77]]) — 서버 = `isShuttleAdmin`·`parentAccountsActor`.
 * 순수 함수(화면·서버 공용 — `server-only` 없음 [[#61]]). 역할·표는 **화면 주인**(강사뷰면 검증된 대상)의 것을 넘긴다.
 */
export function canOpenShuttleAdmin(role: SystemRole, matrix: AccessMatrix, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  return canAccess(role, "shuttle", matrix) && canAccess(role, "shuttle_admin", matrix);
}
