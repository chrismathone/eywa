/**
 * 연차 부여 **테스트 오버라이드** — 파일럿 전용(원장 2026-08-18: *"테스터 테스트 해보게 연차 100개정도
 * 만들어줘"*). 법정 계산(accrual.ts, 최대 25일)으로는 100개가 나올 수 없어, 지정 계정에 한해 부여
 * 일수만 덮어쓴다. 구간(사용 기간)은 입사일 계산 그대로다.
 *
 * 🔴 **실직원 계정을 여기 넣지 말 것** — 실제 연차는 법정 계산이 진실이다(결정 로그: 부여는 저장하지
 *    않고 입사일에서 계산). 이 파일은 파일럿이 끝나면 통째로 지운다(소비처 2곳: getMyLeaveBalance ·
 *    submitLeaveDraft — grep "applyLeaveGrantOverride").
 * ⚠️ 이미 상신된 문서의 `granted_days`는 기안 시점 동결값이라 이 표를 지워도 과거 문서는 안 흔들린다.
 */

import type { LeavePeriod } from "./accrual";

/** 계정별 부여 오버라이드(일). 주석 이름은 설명용 — 판정은 id. */
const LEAVE_GRANT_OVERRIDES: Record<string, number> = {
  "09705ab8-05cf-48ab-8f06-d54a3d990b5c": 100, // 테스터(tst@gmail.com) — 결재 흐름 반복 테스트용
};

/** 오버라이드 대상이면 부여 일수만 바꾼 구간을 돌려준다(그 외엔 입력 그대로). */
export function applyLeaveGrantOverride(
  userId: string,
  period: LeavePeriod | null,
  isChinsanTenant: boolean,
): LeavePeriod | null {
  if (!period || !isChinsanTenant) return period;
  const granted = LEAVE_GRANT_OVERRIDES[userId];
  if (granted === undefined) return period;
  return { ...period, granted, monthly: false, monthsWorked: null, label: `${period.label} (테스트 부여)` };
}
