/**
 * 전자결재 접근·결재선 — **파일럿(테스트 단계)**. 원장 지시 2026-08-14: *"일단 테스트용이라
 * 이승엽 김예원만 보이게 해줘"*.
 *
 * 🔑 왜 하드코딩인가: 이 PC에서 DB 데이터(tenant_settings 개인예외)를 넣을 경로가 없어
 *    (`class_review`처럼 스크립트로 여는 방식은 원장이 직접 돌려야 한다) 배포만으로 명단이 확정되는
 *    코드 상수를 택했다. 사람이 늘면 **이 파일 한 곳**만 고친다 — 메뉴 노출·페이지 게이트·서버 액션이
 *    전부 이 명단에서 파생한다(#77: 화면에서만 숨기는 건 게이트가 아니다).
 * 🔑 이름이 아니라 **user id**로 잠근다(동명이인·개명에 흔들리지 않는다). 이름은 주석으로만.
 *
 * ⚠️ 파일럿을 끝내고 전 직원에게 열 땐 이 명단이 아니라 **`MENU_ACCESS.approvals` 기본값**을 올려라
 *    (결재는 결국 모든 직원의 기능이다). 그때 `approvalMenuOverridesFor`는 지우면 된다.
 */

import type { MenuKey, UserPermissionOverride } from "@/lib/permissions";

/** 파일럿 기간에 전자결재 메뉴가 보이는 계정. 주석 이름·역할은 2026-08-14 실측(판정에 쓰지 않는다). */
export const APPROVAL_PILOT_USER_IDS: readonly string[] = [
  "477950d4-9cb0-4c02-9ac4-f00d42754d55", // 이승엽 (admin · super_admin)
  "8bb70f71-a8c3-450c-9236-561e9b43ca4f", // 김예원 (admin)
];

/**
 * 기본 결재선 — 기안하면 이 순서대로 결재란이 생긴다(순차: 앞 사람이 처리해야 다음 차례).
 *
 * 🔴 최종 목표는 **해당과 부원장 → 경리팀 → 원장&대표**(원장 요구)지만 그 세 자리는 아직 조직도로
 *    모델링돼 있지 않다(직급 문자열만 있고 단계 개념이 없다). 파일럿에선 위 명단과 같은 두 사람으로
 *    두고, 자리가 데이터로 생기면 **이 상수만** 그 조회로 바꾼다(결재선은 기안 시점에 행으로 동결되므로
 *    진행 중인 문서는 안 흔들린다).
 */
export const APPROVAL_LINE_USER_IDS: readonly string[] = APPROVAL_PILOT_USER_IDS;

/** 파일럿 명단에 있는가 — 순수 판정(super_admin 통과는 권한 매트릭스가 얹는다). */
export function isApprovalPilotUser(userId: string): boolean {
  return APPROVAL_PILOT_USER_IDS.includes(userId);
}

/**
 * 이 기안의 결재선(순서 보존) — **기안자 본인은 뺀다**(셀프 결재 금지).
 * 파일럿처럼 명단이 두 명이면 이승엽이 올리면 김예원이, 김예원이 올리면 이승엽이 결재한다.
 * ⚠️ 빈 배열이 나올 수 있다(명단에 기안자 하나만 있을 때) — 호출부가 "결재선 없음"으로 거른다.
 */
export function approvalLineFor(drafterId: string): string[] {
  return APPROVAL_LINE_USER_IDS.filter((id) => id !== drafterId);
}

/** 파일럿으로 여는 메뉴 — `MENU_ACCESS` 기본값이 전 역할 `none`이라 명단 없이는 아무도 못 본다. */
const PILOT_MENUS: readonly MenuKey[] = ["approvals"];

/**
 * 권한 매트릭스에 얹을 **코드 기반 개인 예외**. `tenant_settings`의 userOverrides와 같은 모양이라
 * `applyUserOverrides`가 그대로 처리한다(사이드바·requireAccess·서버 액션이 한 게이트를 공유).
 *
 * ⚠️ super_admin은 명단에 없어도 통과시킨다 — 원장 지시(2026-08-13) *"superadmin은 앞으로 뭘 안해도
 *    그냥 넣고봐"*. 명단만 두면 총괄이 자기 시스템의 신기능에서 잠긴다.
 * ⚠️ 저장된 설정(userOverrides)보다 **먼저** 적용된다 → 원장이 나중에 owner 콘솔에서 이 셀을
 *    덮어쓰면 그쪽이 이긴다(코드가 데이터를 가로막지 않게).
 */
export function approvalMenuOverridesFor(
  userId: string,
  isSuperAdmin: boolean,
): UserPermissionOverride[] {
  if (!isSuperAdmin && !isApprovalPilotUser(userId)) return [];
  return PILOT_MENUS.map((menu) => ({ userId, menu, access: "full" as const }));
}
