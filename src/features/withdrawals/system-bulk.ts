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
 * ⚠️ ~~이 학생들을 목록에서 숨기지는 않는다~~ → 2026-10-15 원장 *"단체 정리면 그냥 장부 정리는 미출력되게"* — 이 42명은 모두
 *    장부 정리 메모가 붙은 수업 기록 없는 퇴원이라 이제 `isBookkeepingOnlyExit`로 **모집단에서 빠진다**(아래). '시스템 정리'
 *    판정은 메모가 없는 같은 모양의 퇴원을 위해 남겨 둔다.
 * ⚠️ `normalizeReason`은 `./types`(순수 모듈)에서 — 이 파일도 클라이언트가 읽을 수 있게 순수하게 둔다.
 * ⚠️ ClassNote 정리 쪽에도 같은 상수가 있다(`scripts/_classnote/offboard-safety.mjs`의
 *    `SYSTEM_BULK_WITHDRAWAL_DATES`). 워커 스크립트(.mjs)는 `src`를 import할 수 없어 부득이 이원화됐다 —
 *    **날짜를 추가할 땐 두 곳을 함께** 고칠 것(근거: 하루 건수 급증 + 수강 종료일 산포).
 */
import { normalizeReason } from "./types";

export const SYSTEM_BULK_WITHDRAWAL_DATES = [
  "2026-07-10", // 하루 119명(다음 순위 12명) · 수강 종료일은 제각각 → status 도장만 일괄
  // ⚠️ 2026-07-03 = 위 119명 중 77명을 "마지막 수강 종료일"로 교정했더니 40명이 몰린 날짜.
  //    `enrollments.end_date`의 최다값이 **2026-07-03(149건)** — 수강 종료일 자체가 일괄이었다.
  //    교정이 장부 날짜를 다른 장부 날짜로 옮긴 셈이라, makeedu 대조(결제 기반)로 다시 채운다.
  "2026-07-03",
] as const;

/**
 * 관리 도구 '데이터 정리'의 일괄 퇴원(수강 없는 재원생 정리)이 남기는 메모 — 그날 그만둔 게 아니라 이미 수업이 없던
 * 학생을 장부에서 정리한 것이다(2026-08-17 31명). 시간표 X 겹침은 이 줄을 빼고 센다(원장 2026-10-14 *"일괄정리는 제외"*).
 * 일괄 퇴원 액션(`bulkWithdrawStudents`)이 이 상수를 그대로 적는다 — 글을 바꾸면 판정도 같이 바뀐다.
 */
export const CLEANUP_WITHDRAWAL_MEMO = "데이터 정리 일괄 퇴원";

/**
 * 같은 성격의 앞선 정리 — 2026-07-10 일회성 스크립트(`scripts/_oneoff/withdraw-no-enrollment.cjs`, 수강 반 없는 재원생
 * 일괄 퇴원)가 남긴 메모 머리 `수강 반 없음 일괄 퇴원 처리 (날짜)`(실측 116명, 사유 전부 '기타'). 원장 2026-10-14 *"이것도 뺀다"*.
 * 스크립트(.cjs)는 src를 import할 수 없어 글을 따로 적었다 — 둘 중 하나를 바꾸면 함께 바꿀 것.
 */
export const LEGACY_CLEANUP_MEMO_PREFIX = "수강 반 없음 일괄 퇴원 처리";

export function isCleanupWithdrawal(memo: string | null | undefined): boolean {
  const m = memo?.trim();
  return !!m && (m === CLEANUP_WITHDRAWAL_MEMO || m.startsWith(LEGACY_CLEANUP_MEMO_PREFIX));
}

/**
 * 퇴원 메타데이터(`students.withdrawal_metadata` jsonb)를 그대로 받아 장부 정리인지 본다(모양이 틀려도 false).
 * 일괄 퇴원은 사유를 늘 '기타'로 적는다 — 퇴원 상세에서 사유를 다른 것(이사 등)으로 고쳤으면 메모가 남아 있어도 실제 퇴원이다
 * (메모 칸은 옛 값으로 미리 채워져 사유만 바꾸기 쉽다, 리뷰 2026-10-15).
 */
export function isCleanupExit(withdrawalMetadata: unknown): boolean {
  if (!withdrawalMetadata || typeof withdrawalMetadata !== "object") return false;
  const { memo, reason } = withdrawalMetadata as { memo?: unknown; reason?: unknown };
  const key = normalizeReason(typeof reason === "string" ? reason : null);
  if (key && key !== "other") return false;
  return typeof memo === "string" && isCleanupWithdrawal(memo);
}

/**
 * **수업 기록 없는 장부 정리 = 퇴원으로 세지도 보이지도 않는다.**
 *
 * 원장 2026-10-15 *"장부정리한 학생들은 그냥 모든곳에서 조용히 정리되도록 … 자꾸 등장하는데"* → *"실제 퇴원일이 존재하면
 * 실제 퇴원일로, 아니고 단체 정리면 그냥 장부 정리는 미출력되게"*.
 * - 끝난 수강이 있는 장부 정리(실측 침산 104명) = 실제로 수업을 듣다 그만둔 학생 — 퇴원일이 마지막 수업 무렵이라(07-10분은
 *   2026-07-30 교정, 정리일 2026-08-17에 묶였던 31명은 `fix-bulk-withdrawal-dates.mjs --cleanup-only`로 마지막 수업 종료일로
 *   옮긴다) **보통 퇴원으로 센다**. 단 **추세선만 예외**(원장 2026-10-20 '청구 기록으로 맞추기') — 그 퇴원일 자체가 장부 날짜인 경우가
 *   많아(07-03 일괄 종료) 추이의 퇴원 칸에서 빼고, 재원생 추이는 청구가 살아 있는 달에만 센다(`dashboard/overview/trend-billing.ts`).
 * - 끝난 수강이 없는 장부 정리(49명) = 수업 없이 장부에만 있던 학생을 단체로 정리한 것 — 퇴원일이 사실이 아니다.
 *   + 끝난 수강이 있어도 **출결·수업료 청구가 한 번도 없으면**(표식 `noClassRecord`, 2026-11-09 · 침산 07-15 정리 26명) 같은 장부 정리다 —
 *   수강 줄만 걸려 있던 폐지 반 학생이라 '수업 기록'이 아니다.
 *   중복 병합된 학생(`isMergedStudent`)처럼 **모집단 단계에서** 뺀다: 퇴원관리 목록·분석·등록 후 띠, 운영실 퇴원 KPI·위젯·
 *   등록·퇴원 추이·시간표 X, 원스크린 증감, 재원생 추이. 'N명 제외' 같은 안내도 두지 않는다(조용히).
 * 🔑 '수업 기록' = 끝난 수강이 있는가 — 시스템 정리(`isSystemBulkWithdrawal`)의 `hasEnrollmentHistory`와 같은 뜻.
 * 🔴 퇴원일을 가짜 날짜로 바꾸지 않는다 — 없는 사실이 DB에 남고 '전체 기간'에선 그대로 보인다.
 * ⚠️ 학생 기록(원생목록 퇴원 보기·학생 상세·퇴원 상세)은 그대로다 — 다시 등록할 때 찾을 수 있어야 한다.
 * ⚠️ 다시 등록하면 메타데이터가 지워지고(`students/server/actions.ts`), 퇴원 상세에서 메모를 고치면 그때부터 퇴원으로 선다.
 */
export function isBookkeepingOnlyExit(row: { withdrawalMetadata: unknown; hasEnrollmentHistory: boolean }): boolean {
  return isCleanupExit(row.withdrawalMetadata) && (!row.hasEnrollmentHistory || hasNoClassRecordMark(row.withdrawalMetadata));
}

/**
 * 퇴원 메타데이터의 '수업 흔적 없음' 표식 키 — 장부 정리 일괄 퇴원 때 그 학생의 **출결 기록과 수업료 청구(취소·환불 제외)가 한 번도 없으면**
 * 앱이 `true`로 굳힌다(`markNoClassRecord`, 기존 줄은 `scripts/_oneoff/backfill-bookkeeping-no-class-record.mjs`).
 * 원장 2026-11-09 *"저렇게 처리했음 알아서 걸러야지 왜 자꾸 언급하나"* — 2026-07-15 정리 31명 중 26명은 폐지된 고등 수학반에 **수강 줄만** 걸려
 * 있었고 출결·청구가 0이었다. '끝난 수강이 있으면 실제 퇴원'만 보던 판정이 이들을 퇴원관리·운영실·학원 비서 어디서나 7월 퇴원으로 세웠다.
 * 🔑 판정을 소비처마다 출결·청구를 다시 읽어 하지 않는다(느리고 갈라진다) — 표식 한 칸을 모두가 읽는다. 비서 보기도 같은 칸(s2_0041).
 * ⚠️ 다시 등록하면 메타데이터가 통째로 지워져 표식도 사라진다(그때부터 다시 판정 대상).
 */
export const NO_CLASS_RECORD_KEY = "noClassRecord";

export function hasNoClassRecordMark(withdrawalMetadata: unknown): boolean {
  return !!withdrawalMetadata && typeof withdrawalMetadata === "object" && (withdrawalMetadata as Record<string, unknown>)[NO_CLASS_RECORD_KEY] === true;
}

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
