/**
 * **연차 조정 자격** — 남의 연차 부여 일수를 바꿀 수 있는 사람.
 *
 * 원장 2026-09-08: *"관리자랑 김예원이 직원들의 연차갯수를 조정해야하는데 해당 기능이 없음"* →
 * 되물음에 *"여기서 관리자는 박소선 이승엽 김예원임"*.
 *
 * 🔑 화면 자리는 **직원관리**다(원장 2026-09-09: *"직원관리에 버튼 연동해주지 전자결재에 있는게 연차를
 *    관리하는게 이상하자나"*). 휴가 **신청·결재**는 전자결재(`/approvals`), 연차 **부여 일수**는 직원
 *    정보라 직원관리(`/staff/annual-leave`) — 두 자리는 다른 일을 한다.
 *    ⚠️ 이 명단은 직원관리 메뉴 권한과 **별개의 좁은 문**이다. 직원관리를 볼 수 있는 사람(설현·오은진·
 *    엄소윤 등)이 곧 연차를 고칠 수 있는 사람은 아니다 — 원장이 셋을 콕 집었다.
 * 🔴 **반대 방향은 전제다**: 화면이 `/staff` 안에 있어 `requireAccess("staff")`를 먼저 지난다 — 즉
 *    **이 명단의 세 사람은 직원관리 메뉴가 열려 있어야 한다**(2026-09-09 실측: 박소선=master 기본 full,
 *    이승엽·김예원=개인 예외 `staff: full`). 나중에 "예외가 너무 많다"고 이승엽·김예원을
 *    `scripts/staff-access/narrow-staff-menu.mjs`의 GRANTEES에서 빼면, `canAdjustLeave`는 true인데
 *    페이지가 튕겨 **버튼도 안 뜨고 에러도 없이 기능만 죽는다**. 명단을 손볼 땐 그쪽도 함께 볼 것.
 * 🔑 이름이 아니라 user id로 잠근다(payslip-access.ts와 같은 규약 — 개명·동명이인에 안 흔들린다).
 * ⚠️ 사람이 바뀌면 **여기 한 곳**만 고친다(화면·서버 액션이 같은 함수를 통과한다, [[#77]]).
 */

/** 조정 허용 계정. 주석의 이름·역할은 2026-09-08 실측값(설명용이며 판정에 쓰지 않는다). */
export const LEAVE_ADJUSTER_USER_IDS: readonly string[] = [
  "fcf735fa-edf7-4095-8fa6-724285a018ed", // 박소선 (master)
  "477950d4-9cb0-4c02-9ac4-f00d42754d55", // 이승엽 (admin · super_admin)
  "8bb70f71-a8c3-450c-9236-561e9b43ca4f", // 김예원 (admin)
];

/** 연차 조정 게이트 — 화면·서버 액션이 **같은 함수**를 통과한다([[#77]]). */
export function canAdjustLeave(
  userId: string,
  isSuperAdmin: boolean,
  policy: { isChinsanTenant: boolean; adjusterIds: readonly string[] },
): boolean {
  // super_admin은 새로 만드는 어떤 제한 명단도 자동 통과(원장 2026-08-13 — 총괄이 자기 시스템에 잠기지 않게).
  return isSuperAdmin || (policy.isChinsanTenant
    ? LEAVE_ADJUSTER_USER_IDS.includes(userId)
    : policy.adjusterIds.includes(userId));
}

export const LEAVE_ADJUST_DENIED_MSG = "연차를 조정할 권한이 없습니다";
