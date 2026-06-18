// 수강종료(과목 이탈) 판정 — 순수 함수(테스트 강제). UI·DB 비의존.
// "수강종료" = 재원(enrolled/on_hold) 중이지만 특정 과목의 enrollment가 전부 종료(end_date 있음)되고
// 그 과목에 활성(end_date NULL) enrollment가 하나도 없는 상태 = 그 과목만 끊은 조기 이탈 신호.

export type SubjectEnrollment = { subject: string; endDate: string | null };

export type SubjectSplit = {
  /** 활성 enrollment가 하나도 없고 종료 이력만 있는 과목 코드들. */
  ended: string[];
  /** 활성(end_date NULL) enrollment가 하나 이상인 과목 코드들. */
  active: string[];
};

/** 학생의 enrollment 목록을 과목별로 접어 종료/활성 과목을 가른다. 입력 순서 무관. */
export function getEndedSubjects(enrollments: SubjectEnrollment[]): SubjectSplit {
  const map = new Map<string, { active: boolean; ended: boolean }>();
  for (const e of enrollments) {
    const cur = map.get(e.subject) ?? { active: false, ended: false };
    if (e.endDate == null) cur.active = true;
    else cur.ended = true;
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

/** 수강종료 학생인가 = 종료된 과목이 하나 이상. (호출부에서 status=enrolled/on_hold로 이미 필터.) */
export function isSubjectEnded(enrollments: SubjectEnrollment[]): boolean {
  return getEndedSubjects(enrollments).ended.length > 0;
}
