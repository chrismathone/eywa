/** 기준일에 실제 수강 대상인지 판정한다(반이동은 반열림, 일반 종료는 종료일 포함). */
export function isEnrollmentActiveOn(
  enrollment: { startDate: string; endDate: string | null; onHold: boolean; isTransferred?: boolean },
  date: string,
): boolean {
  if (enrollment.onHold || enrollment.startDate > date) return false;
  if (!enrollment.endDate) return true;
  // 반이동 RPC는 old.end_date = new.start_date로 저장하며 daterange는 [start,end)다.
  // 일반 퇴원 end_date는 기존 화면·출결 규칙대로 해당 날짜까지 포함한다.
  return enrollment.isTransferred ? enrollment.endDate > date : enrollment.endDate >= date;
}

/** 분리등원 요일: 빈 배열은 반의 모든 운영 요일, 값이 있으면 해당 요일만 대상이다. */
export function enrollmentAttendsOnDay(
  attendanceDays: readonly string[] | null,
  dayKey: string,
): boolean {
  return !attendanceDays || attendanceDays.length === 0 || attendanceDays.includes(dayKey);
}
