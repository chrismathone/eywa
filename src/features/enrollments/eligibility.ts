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

/**
 * 같은 (학생, 반)의 두 수강 기간이 겹치는가 — **DB GiST `enrollments_no_overlap`과 같은 규칙**.
 *
 * 제약은 `daterange(start_date, coalesce(end_date,'infinity'), '[)')`라 **종료일은 제외(반열림)**다.
 * 즉 A가 8/4에 끝나고 B가 8/4에 시작하면 겹치지 않는다(반 이동이 이 경계를 쓴다, 0063a).
 *
 * ⚠️ 표시용 종료 규약(`isEnrollmentEndedOn` — 일반 종료는 종료일 당일까지 재원)과 **다르다.**
 * 여기서 그 규약을 쓰면 화면 판정과 DB 판정이 갈려 "화면은 괜찮다는데 저장이 거부"가 난다.
 * 이 함수는 저장 가능 여부를 **미리 알려주는 용도**(배정 다이얼로그)로만 쓴다.
 */
export function enrollmentPeriodsOverlap(
  aStart: string,
  aEnd: string | null | undefined,
  bStart: string,
  bEnd: string | null | undefined,
): boolean {
  return (!aEnd || bStart < aEnd) && (!bEnd || aStart < bEnd);
}

/** 분리등원 요일: 빈 배열은 반의 모든 운영 요일, 값이 있으면 해당 요일만 대상이다. */
export function enrollmentAttendsOnDay(
  attendanceDays: readonly string[] | null,
  dayKey: string,
): boolean {
  return !attendanceDays || attendanceDays.length === 0 || attendanceDays.includes(dayKey);
}

/**
 * 이 **학생 상태**로 새 수강을 만들 수 있는가 — 못 하면 화면·서버가 함께 쓰는 **한글 이유**를 돌려준다
 * (null = 배정 가능).
 *
 * 배경(원장 2026-08-20 *"합리적이 될 수 있도록 휴원 해결해야겠어"*): `createEnrollment`가 학생 상태를
 * **아예 보지 않아서**, 휴원 학생에게 반을 배정하면 새 수강의 `on_hold`가 기본값 false로 들어갔다.
 * 출석부·원스크린·좌석표 로스터는 전부 **수강의 on_hold**로 거르고 학생 상태는 안 보므로,
 * 학생목록엔 휴원인 아이가 **출석부엔 그대로 뜨는** 앞뒤 안 맞는 상태가 됐다.
 *
 * 🔴 이 판정은 **서버(createEnrollment)가 진짜 게이트**다 — 화면은 같은 이유를 보여줄 뿐이다([[#77]]).
 * ⚠️ 모르는 상태 코드는 **허용**(fail-open) — 상태 enum이 늘었을 때 배정이 통째로 막히는 쪽이 더 나쁘다
 *    (권한 폴백 fail-open과 같은 결, [[#60]]).
 * ⚠️ 정식 등록 경로(등록상담 전환 `convertConsultationToStudent`·시간표 엑셀 가져오기)는
 *    `createEnrollment`를 거치지 않고 enrollments에 직접 insert하므로 이 게이트에 걸리지 않는다.
 *    (상담 전환은 학생을 `status:'enrolled'`로 만든 뒤 배정하는 순서라 어차피 통과한다.)
 */
export function enrollmentAssignBlockReason(status: string | null | undefined): string | null {
  switch (status) {
    case "on_hold":
      return "휴원 중인 학생입니다 — 재원으로 되돌린 뒤 배정해 주세요.";
    case "withdrawn":
      return "퇴원한 학생입니다 — 재원으로 복구한 뒤 배정해 주세요.";
    case "prospect":
    case "consulted":
      return "아직 재원 학생이 아닙니다 — 상태를 '재원'으로 전환한 뒤 배정해 주세요.";
    default:
      return null;
  }
}
