/**
 * 담임 / 부담임 판정 — 순수 함수(Vitest). 원장 정의 2026-08-06:
 *
 *   · **담임**   = 같은 과목에서 학생이 여러 수업을 들을 때 **가장 많이 수업하는 강사**
 *   · **부담임** = 그 외 강사
 *
 * 🔴 담임은 DB 컬럼이 아니라 **파생**이다. eywa의 `classes.teacher_id`는 "그 반의 담당"이지 "그 학생의
 *    담임"이 아니다 — 한 학생이 같은 과목에서 주 2회(A강사) + 주 1회(B강사)를 들으면 담임은 A다.
 * ⚠️ 반드시 **같은 과목 안에서만** 비교한다. 수학 3회·영어 2회를 견주면 영어 담임이 사라진다.
 */

export type TeacherRole = "primary" | "assistant" | null;

/** 한 학생의 (과목 안) 수업 한 건 — 강사와 주당 수업 횟수. */
export type SubjectSession = {
  teacherId: string | null;
  /** 주당 수업 횟수(= 그 반에서 이 학생의 등원요일 수). 분리등원이면 실제 오는 요일만 센다. */
  sessionsPerWeek: number;
};

/**
 * 이 학생에 대한 `teacherId`의 역할.
 *
 * @returns `primary`(담임) · `assistant`(부담임) · `null`(이 과목에서 이 학생을 안 가르침)
 *
 * ⚠️ **동률이면 둘 다 담임**이다. "가장 많이 수업하는 강사"라는 정의는 동률에 답을 주지 않으므로
 *    한쪽을 임의로 부담임으로 강등하지 않는다(지어낸 사실을 화면에 쓰지 않는다).
 * ⚠️ 수업이 1건뿐이어도 담임이다 — "여러 수업을 들을 때"는 부담임이 생기는 조건이지 담임의 조건이 아니다.
 */
export function resolveTeacherRole(sessions: readonly SubjectSession[], teacherId: string): TeacherRole {
  const mine = sessions.filter((s) => s.teacherId === teacherId);
  if (mine.length === 0) return null;
  // 같은 강사가 한 과목에서 여러 반을 맡을 수 있다(예: 월수 반 + 토 반) → 합산해서 견준다.
  const totalOf = (id: string | null) =>
    sessions.filter((s) => s.teacherId === id).reduce((n, s) => n + Math.max(0, s.sessionsPerWeek), 0);
  const myTotal = totalOf(teacherId);
  const best = Math.max(...[...new Set(sessions.map((s) => s.teacherId))].map(totalOf));
  return myTotal >= best ? "primary" : "assistant";
}
