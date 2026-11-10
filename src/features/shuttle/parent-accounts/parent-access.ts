/** 학부모 관리 현황 화면 주소 — 화면·메뉴 입구·재검증이 같은 값을 쓴다. */
export const SHUTTLE_PARENTS_PATH = "/shuttle/parents";

// 학부모 계정을 보고 발급할 수 있는가 — 2026-11-10부터 역할 비교(옛 `canManageParentAccountsRole`)가 아니라 '셔틀 관리자 화면' 권한(`shuttle_admin`)이다.
// 판정 = `canOpenShuttleAdmin`(../admin-access.ts) · 서버 = `parentAccountsActor`. 원장·관리자 칸만 바꿀 수 있다(DB 정책 0320a와 같은 두 역할 — `SHUTTLE_ADMIN_ROLES`).
