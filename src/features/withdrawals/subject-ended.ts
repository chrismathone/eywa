// 수강종료(과목 이탈) 판정 — 순수 함수(테스트 강제). UI·DB 비의존.
// "수강종료" = 재원(enrolled/on_hold) 중이지만 특정 과목의 enrollment가 **오늘 기준 전부 끝났고**
// 그 과목에 아직 다니는(또는 앞으로 시작할) enrollment가 하나도 없는 상태 = 그 과목만 끊은 이탈 신호.
// 원장 2026-09-14 *"1과목이 완전히 종료되면 그 과목에 대해서는 퇴원 … 두과목 모두다 퇴원하면 완전한 퇴원"*.
// 🔴 end_date가 **있기만 하면** 끝난 것으로 보지 않는다 — 종료 예정일이 미래인 반은 아직 다니는 중이다
//    (예전엔 날짜 비교 없이 잡아 계속 다니는 학생이 수강종료 목록에 섰다). 끝남 판정은
//    [eligibility](@/features/enrollments/eligibility) `isEnrollmentEndedOn` 그대로(반이동 반열림 규약 포함).
// 🔴 **끝난 특강은 수강종료가 아니다**(원장 2026-09-28 *"퇴원 (수강종료)카운트에 특강은 제외. 특강을 수강종료했어도 여전히
//    같은 과목의 다른 수업을 듣고 있으면 수강 종료 및 퇴원으로 처리하지않아야함"*) — 방학 단기강좌가 끝난 것이지 과목을 끊은
//    것이 아니다. 끝난 특강 수강은 판정에서 통째로 뺀다(`countsForSubjectExit`). 다니는 중인 특강은 그 과목을 '수강 중'으로 둔다.

import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";

export type SubjectEnrollment = {
  subject: string;
  endDate: string | null;
  /** 반이동으로 닫힌 수강(`enrollments.is_transferred`) — 종료일 당일부터 끝난 것으로 본다. */
  isTransferred?: boolean;
  /** 특강 반([`isSpecialLecture`](@/features/classes/special-lecture)) — 끝난 특강은 과목 이탈로 세지 않는다. */
  isSpecial?: boolean;
};

/** 과목 이탈 판정에 넣는 수강인가 — 끝난 특강만 뺀다(위 🔴). 목록의 날짜·반 이름도 같은 술어로 고른다. */
export function countsForSubjectExit(e: SubjectEnrollment, today: string): boolean {
  return !(e.isSpecial && isEnrollmentEndedOn(e.endDate, today, e.isTransferred));
}

export type SubjectSplit = {
  /** 오늘 기준 모든 수강이 끝난 과목 코드들. */
  ended: string[];
  /** 아직 끝나지 않은 수강(종료일 없음·종료 예정일이 오늘 이후)이 하나 이상인 과목 코드들. */
  active: string[];
};

/**
 * 학생의 enrollment 목록을 과목별로 접어 종료/활성 과목을 가른다. 입력 순서 무관.
 * @param today 기준일(KST `YYYY-MM-DD`) — 호출부가 `kstToday()`를 넘긴다(여기서 시계를 읽지 않는다).
 */
export function getEndedSubjects(enrollments: SubjectEnrollment[], today: string): SubjectSplit {
  const map = new Map<string, { active: boolean; ended: boolean }>();
  for (const e of enrollments) {
    if (!countsForSubjectExit(e, today)) continue;
    const cur = map.get(e.subject) ?? { active: false, ended: false };
    if (isEnrollmentEndedOn(e.endDate, today, e.isTransferred)) cur.ended = true;
    else cur.active = true;
    map.set(e.subject, cur);
  }
  const ended: string[] = [];
  const active: string[] = [];
  for (const [subject, s] of map) {
    if (s.active) active.push(subject); // 활성 enrollment가 있으면 그 과목은 종료 아님
    else if (s.ended) ended.push(subject);
  }
  return { ended, active };
}

/** 수강종료 학생인가 = 오늘 기준 끝난 과목이 하나 이상. (호출부에서 status=enrolled/on_hold로 이미 필터.) */
export function isSubjectEnded(enrollments: SubjectEnrollment[], today: string): boolean {
  return getEndedSubjects(enrollments, today).ended.length > 0;
}
