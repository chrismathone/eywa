import type { SystemRole } from "@/lib/permissions";

/** 학부모 관리 현황 화면 주소 — 화면·메뉴 입구·재검증이 같은 값을 쓴다. */
export const SHUTTLE_PARENTS_PATH = "/shuttle/parents";

/**
 * 학부모 계정을 보고 발급할 수 있는가 — **원장(master)·관리자(admin) + 총괄(super_admin)**.
 *
 * 🔴 셔틀 메뉴 권한(`shuttle`)과 **별개 축**이다. 셔틀은 매니저가 full이고 강사·뷰어도 열람하지만,
 *    학부모 계정엔 로그인 이메일·연락처가 실려서 원장·관리자로만 좁힌다.
 * 🔴 화면(메뉴 입구·페이지)·서버 액션·조회·DB 정책(0320a)이 **전부 이 판정**을 지난다([[#77]]).
 *    한 곳만 고치면 입구는 닫혔는데 주소를 치면 열리는 꼴이 된다.
 * 총괄(super_admin)은 역할이 아니라 별도 표라 `isSuperAdmin`을 함께 받는다(결정 로그 2026-08-13).
 */
export function canManageParentAccountsRole(role: SystemRole, isSuperAdmin: boolean): boolean {
  return isSuperAdmin || role === "master" || role === "admin";
}
