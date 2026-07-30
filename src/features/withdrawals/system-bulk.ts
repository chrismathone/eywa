/**
 * 시스템 일괄 퇴원 — **실제 퇴원 시점이 아닌 장부상 날짜**를 구분하기 위한 순수 판정.
 *
 * 배경(2026-07-30, 원장 지시): `2026-07-10` 하루에 **119명**이 퇴원으로 찍혔는데(다음으로 많은 날은 07-13의
 * 12명) 그들의 **수강 종료일은 제각각**이었다(07-03 40 · 04-06 15 · 05-04 8 · 03-31 7 …). 그날 수업이 끝난 게
 * 아니라 **이미 끝나 있던 학생들에게 일괄로 `status=withdrawn` 도장을 찍은 날**이다.
 *
 * 그중 **마지막 수강 종료일을 알 수 있는 77명은 실제 날짜로 교정**했고
 * (`scripts/_poc_migration/fix-bulk-withdrawal-dates.mjs`), **수강 이력이 아예 없는 42명은 교정할 수 없어**
 * 그 날짜에 남아 있다 — 추측해서 넣으면 없는 사실을 만드는 것이라 손대지 않았다.
 *
 * 그래서 화면에서는 이 42명을 **'시스템 정리(날짜 미상)'로 구분**하고 **월별 추이에서 제외**한다.
 * 그러지 않으면 "7월 퇴원 115명"처럼 실제와 다른 숫자가 그대로 읽힌다(교정 전엔 152명이었다).
 *
 * ⚠️ 이 학생들을 **목록에서 숨기지는 않는다** — 그들은 실제로 퇴원한 게 맞고 **날짜만** 모른다.
 *    숨기면 퇴원생 명단이 비어 오히려 사실과 멀어진다.
 * ⚠️ ClassNote 정리 쪽에도 같은 상수가 있다(`scripts/_classnote/offboard-safety.mjs`의
 *    `SYSTEM_BULK_WITHDRAWAL_DATES`). 워커 스크립트(.mjs)는 `src`를 import할 수 없어 부득이 이원화됐다 —
 *    **날짜를 추가할 땐 두 곳을 함께** 고칠 것(근거: 하루 건수 급증 + 수강 종료일 산포).
 */
export const SYSTEM_BULK_WITHDRAWAL_DATES = [
  "2026-07-10", // 하루 119명(다음 순위 12명) · 수강 종료일은 제각각 → status 도장만 일괄
  // ⚠️ 2026-07-03 = 위 119명 중 77명을 "마지막 수강 종료일"로 교정했더니 40명이 몰린 날짜.
  //    `enrollments.end_date`의 최다값이 **2026-07-03(149건)** — 수강 종료일 자체가 일괄이었다.
  //    교정이 장부 날짜를 다른 장부 날짜로 옮긴 셈이라, makeedu 대조(결제 기반)로 다시 채운다.
  "2026-07-03",
] as const;

/** 그 퇴원일이 시스템 일괄 처리분인가(날짜만 본다). */
export function isSystemBulkWithdrawalDate(withdrawnAt: string | null): boolean {
  if (!withdrawnAt) return false;
  return (SYSTEM_BULK_WITHDRAWAL_DATES as readonly string[]).includes(withdrawnAt.slice(0, 10));
}

/**
 * 화면에서 '시스템 정리(날짜 미상)'로 구분할 행인가.
 *
 * 조건 = **일괄 날짜** + **수강 이력 없음**. 수강 이력이 있으면 교정 대상이었으므로(이미 실제 날짜로 바뀌었다)
 * 여기 걸리지 않는다. 즉 "날짜를 끝내 알 수 없는 잔여분"만 표시된다.
 */
export function isSystemBulkWithdrawal(row: {
  withdrawnAt: string | null;
  hasEnrollmentHistory: boolean;
}): boolean {
  return isSystemBulkWithdrawalDate(row.withdrawnAt) && !row.hasEnrollmentHistory;
}
