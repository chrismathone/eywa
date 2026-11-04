/**
 * '수업보고서 미발송'을 **켜기 전** 경고 — 최근 30일 동안 ClassNote로 보고서를 보낸 반이면 켜는 순간 확인을 받는다.
 * (순수 · Vitest — 화면 class-report-fields.tsx · 건수 server/report-optout-sent.ts)
 *
 * 🔴 2026-11-04 사고: 10-30에 JJ 반 전체를 한꺼번에 미발송으로 바꿨는데 그중 14반은 매주 보고서를 보내던 반이었다
 *    (원스크린 보고서 칸 잠김 → 다음 날 정기 동기화가 반 보드 연결을 지움 → 선생님들이 보고서를 못 보냄).
 * 서버는 막지 않는다 — 원장이 고를 수 있는 설정이다. 화면이 건수를 보여 주고 확인 체크를 받아야 저장된다.
 *
 * ⚠️ 보드 연결 문장은 **수학 반에만** 붙이고 "풀립니다"로 단정한다. 미발송 수학 반은 ClassNote 반 보드 대상이 아니다 — 원장
 *    2026-11-04 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"*(11-03 'JJ 맞춤' 되돌림 · 연동 PC 1.0.11·1.0.13 모두 같은 조건).
 *    그래서 다음 정기 동기화가 그 반의 연결을 지운다(설계상 정리 · 11-04 사고의 경로). 영어 반 방 연결
 *    (`classnote_english_class_boards`)은 미발송과 무관하게 남으므로 영어 반엔 보드 문장을 붙이지 않는다(리뷰 2026-11-04).
 *    수학 = `SEND_CLASS_SUBJECTS`(math·subject_1 — 워커 `targetClassWhere`와 같은 값). 대상 조건을 바꾸면 이 문장과 테스트를
 *    함께 바꿀 것(조건 가드 = src/features/onescreen/classnote-target-guard.test.ts).
 */
import { inclusiveDateWindowStart } from "@/lib/date-kst";

/** 경고 기준 기간(오늘 포함). */
export const RECENT_SENT_DAYS = 30;

/** 건수를 세는 보고서 날짜 범위(`report_date`, 양끝 포함). */
export function recentSentWindow(today: string): { from: string; to: string } {
  return { from: inclusiveDateWindowStart(today, RECENT_SENT_DAYS), to: today };
}

/**
 * 켜는 순간 확인이 필요한가.
 * · 화면을 열 때 이미 미발송이던 반(`initial`)은 켜는 일이 아니라 경고하지 않는다. 끄는 쪽도 경고 없음.
 * · `recentSent === undefined` = 셀 대상이 없는 화면(새 반 만들기) → 경고 없음.
 * · `null` = 건수를 못 셌다 → 보내던 반인지 모르니 **경고한다**(못 셌다고 경고를 없애면 사고 경로가 그대로 열린다).
 */
export function needsReportOptoutConfirm(p: {
  initial: boolean;
  next: boolean;
  recentSent: number | null | undefined;
}): boolean {
  if (p.initial || !p.next || p.recentSent === undefined) return false;
  return p.recentSent === null || p.recentSent > 0;
}

/** 켜면 생기는 일 — 반 보드 발송 과목(수학)이면 반 보드 연결까지 풀린다(위 머리 주석). */
const effectOf = (boardRoute: boolean) =>
  boardRoute
    ? "미발송으로 바꾸면 이 반 보고서 칸이 잠기고(출결만 기록), ClassNote 반 보드 연결도 다음 정기 동기화 때 풀립니다."
    : "미발송으로 바꾸면 이 반 보고서 칸이 잠깁니다(출결만 기록).";

/**
 * 경고 본문. `null`이면 건수를 못 셌다는 사실을 그대로 말한다(0건으로 지어내지 않는다).
 * `boardRoute` = 이 반이 ClassNote 반 보드로 보고서를 보내는 과목인가(수학 — 폼의 지금 과목으로 정한다).
 */
export function reportOptoutWarning(recentSent: number | null, boardRoute: boolean): string {
  const EFFECT = effectOf(boardRoute);
  if (recentSent === null) {
    return `최근 ${RECENT_SENT_DAYS}일 동안 이 반이 보낸 수업보고서 건수를 확인하지 못했습니다. ${EFFECT}`;
  }
  return `이 반은 최근 ${RECENT_SENT_DAYS}일 동안 수업보고서 ${recentSent}건을 보냈습니다. ${EFFECT}`;
}

/** 확인 체크 라벨 · 체크 없이 저장을 누르면 뜨는 안내(브라우저 검증 말풍선). */
export const REPORT_OPTOUT_CONFIRM_LABEL = "확인했습니다 — 미발송으로 바꿉니다";
export const REPORT_OPTOUT_CONFIRM_REQUIRED = "미발송으로 바꾸려면 위 경고를 읽고 '확인했습니다'에 체크해 주세요.";
