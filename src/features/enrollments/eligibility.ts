/**
 * 기준일에 **수강 종료가 이미 지났는지** — 종료 규약의 단일 소스.
 *
 * 반이동 RPC는 old.end_date = new.start_date로 저장하며 daterange는 [start,end)다(그날은 이미 새 반).
 * 일반 퇴원·반 이탈 end_date는 기존 화면·출결 규칙대로 **해당 날짜까지 포함**한다(그날은 아직 재원).
 *
 * ⚠️ 이 규약을 호출부에서 다시 구현하지 말 것 — 시간표 주간뷰가 `end <= ref`로 따로 구현했다가
 * 일반 종료 학생을 **마지막 날에 하루 일찍 퇴원 처리**해, 같은 날 '오늘 일정'엔 재원인데 주간뷰엔
 * 퇴원으로 갈리는 모순이 있었다(2026-07-17 적대 감사 M6).
 */
export function isEnrollmentEndedOn(
  endDate: string | null | undefined,
  date: string,
  isTransferred?: boolean,
): boolean {
  if (!endDate) return false;
  return isTransferred ? endDate <= date : endDate < date;
}

/** 기준일에 실제 수강 대상인지 판정한다(반이동은 반열림, 일반 종료는 종료일 포함). */
export function isEnrollmentActiveOn(
  enrollment: { startDate: string; endDate: string | null; onHold: boolean; isTransferred?: boolean },
  date: string,
): boolean {
  if (enrollment.onHold || enrollment.startDate > date) return false;
  return !isEnrollmentEndedOn(enrollment.endDate, date, enrollment.isTransferred);
}

/** 분리등원 요일: 빈 배열은 반의 모든 운영 요일, 값이 있으면 해당 요일만 대상이다. */
export function enrollmentAttendsOnDay(
  attendanceDays: readonly string[] | null,
  dayKey: string,
): boolean {
  return !attendanceDays || attendanceDays.length === 0 || attendanceDays.includes(dayKey);
}
