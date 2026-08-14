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
 * 결재자·참조자 **후보 풀** — 기안 화면의 결재선 편집기가 이 명단에서 고른다(하이웍스의 조직도 선택
 * 대응). 파일럿 동안은 파일럿 명단과 같다 — 명단 밖 사람을 결재자로 지정하면 그 사람은 메뉴가 없어
 * 문서를 처리할 수 없기 때문(결재선이 거기서 영원히 멈춘다).
 *
 * 🔴 전사 개방 시 이 함수를 **활성 직원 전체 조회**로 바꾼다(메뉴 기본값을 올리는 것과 같은 커밋에서).
 *    최종 목표인 "해당과 부원장 → 경리팀 → 원장&대표" 기본 결재선은 그 자리가 조직도로 생기면
 *    기본 템플릿(자주 쓰는 결재선)으로 내려준다.
 */
export function approverCandidateIds(): readonly string[] {
  return APPROVAL_PILOT_USER_IDS;
}

/** 파일럿 명단에 있는가 — 순수 판정(super_admin 통과는 권한 매트릭스가 얹는다). */
export function isApprovalPilotUser(userId: string): boolean {
  return APPROVAL_PILOT_USER_IDS.includes(userId);
}

/**
 * 기본 결재선(폼 초기값) — 후보 풀에서 기안자만 뺀 순서. 파일럿처럼 두 명이면 서로가 서로의
 * 결재자다. 기안자가 편집기에서 바꿀 수 있고, **저장은 서버가 다시 검증한다**(line.ts).
 */
export function approvalLineFor(drafterId: string): string[] {
  return approverCandidateIds().filter((id) => id !== drafterId);
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
