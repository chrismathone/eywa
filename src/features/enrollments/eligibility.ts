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
 * 기준일에서 본 수강의 **시간 축 위치** — 명단·배너가 "지금"과 "예정"을 가르는 단일 소스.
 *
 * 🔴 왜 필요한가(2026-08-29 실측): 미래 시작 수강 28건·미래 종료 15건이 이미 DB에 있는데
 *    화면마다 답이 달랐다. 반 상세 명단은 **종료만 보고 시작을 안 봐서** 9/3부터인 학생이
 *    오늘 명단에 있었고, 학생 개요는 `!endDate`로 잘라 **아직 다니는 반이 증발**했다.
 *    출결 계열만 두 경계를 다 봐서 정확했다.
 *
 * 🔴 **`on_hold`는 이 축에 넣지 않는다.** 휴원은 시간이 아니라 상태이고, 반 명단은 휴원 학생을
 *    (배지를 달아) **남겨 둔다**([classes/server/queries.ts]). 여기에 섞으면 휴원 학생이 명단에서
 *    통째로 증발한다. 출결용 판정은 `isEnrollmentActiveOn`이 따로 있고 그쪽은 휴원을 뺀다 —
 *    두 함수는 **쓰는 자리가 다르다**(명단 표시 vs 출결 대상).
 *
 * `active`와 `leaving`은 **둘 다 "오늘 수강 중"** 이다 — 세는 자리에선 합쳐야 한다.
 */
export type EnrollmentPhase =
  /** 아직 시작 안 함(예약된 배정·이동의 도착지). */
  | "upcoming"
  /** 수강 중이고 끝날 날짜가 없다. */
  | "active"
  /** 수강 중이지만 끝날 날짜가 잡혀 있다(예약된 이동의 출발지·종료 예정). */
  | "leaving"
  /** 이미 끝났다. */
  | "ended";

export function enrollmentPhaseOn(
  enrollment: { startDate: string; endDate: string | null; isTransferred?: boolean },
  date: string,
): EnrollmentPhase {
  if (enrollment.startDate > date) return "upcoming";
  if (isEnrollmentEndedOn(enrollment.endDate, date, enrollment.isTransferred)) return "ended";
  return enrollment.endDate ? "leaving" : "active";
}

/** 기준일에 **명단에 있는가**(휴원 포함 — 위 주석의 이유). `active` ∪ `leaving`. */
export function isEnrollmentOnRosterOn(
  enrollment: { startDate: string; endDate: string | null; isTransferred?: boolean },
  date: string,
): boolean {
  const phase = enrollmentPhaseOn(enrollment, date);
  return phase === "active" || phase === "leaving";
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
 * ⚠️ 정식 등록 경로 둘은 `createEnrollment`를 거치지 않고 enrollments에 직접 insert하므로 이 게이트에
 *    **걸리지 않는다.** 확인한 이유는 이렇다(둘 다 그대로 두는 게 옳다):
 *    · **등록상담 전환**(`convertConsultationToStudent`) — 학생을 `status:'enrolled'`로 **만든 뒤** 배정하는
 *      순서라 애초에 어긋날 수가 없다(게이트를 태워도 통과한다).
 *    · **시간표 엑셀·시트 가져오기**(`applyDiff`) — 시트는 *"어느 반인가"*의 진실이지 *"휴원인가"*의
 *      진실이 아니다. 그래서 **거절이 아니라 승계**한다: 휴원 학생 행은 `on_hold: true`로 넣는다
 *      (반 이동 RPC 0228a와 같은 결). 🔴 대량 경로에서 **조용히 건너뛰지 않는다** — 안 들어가면
 *      "왜 이 아이만 빠졌지"가 되고, 결과 요약에도 승계 건수를 적는다(enrollmentOnHoldForStatus).
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

/**
 * 학생 상태 → **새로 만드는 수강의 `on_hold` 초깃값.** 승계 경로(시간표 엑셀·시트 가져오기, 반 이동
 * RPC 0228a)가 공유하는 규칙 — 학생이 휴원이면 그 수강도 휴원 표식을 달고 태어난다.
 *
 * 🔴 로스터(출석부·원스크린·좌석표)는 **수강의 on_hold**만 보고 학생 상태는 안 본다 — 이 값이 false로
 *    새로 생기면 "학생목록엔 휴원인데 출석부엔 그대로"가 된다(2026-08-20에 막은 구멍 셋의 공통 원인).
 */
export function enrollmentOnHoldForStatus(status: string | null | undefined): boolean {
  return status === "on_hold";
}
