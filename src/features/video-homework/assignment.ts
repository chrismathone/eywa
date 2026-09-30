/**
 * "그 수업에 영상 과제가 있었나"(0308a `lesson_reports.video_homework`) — 판정 한 벌. 서버·화면 공용(순수).
 *
 * 값은 세 가지다: true(있음) · false(없음) · 모름(키 없음 = 기능 이전 보고서·다른 저장 경로·컬럼 미적용).
 * 🔴 다음 수업 '지난 수업 영상 숙제' 검사는 **없음(false)일 때만** 숨긴다 — 모름을 없음으로 읽으면 이 기능 전의
 *    모든 보고서가 '영상 과제 없음'이 되어 검사 칸이 통째로 사라진다(원장 2026-09-30 도입 당일).
 */
export type VideoHomeworkAssignments = Readonly<Record<string, boolean>>;

/** 학생 × 수업 날짜 × 반 — 반이 없는 보고서(보강·옛 이관분)는 다음 수업 검사(반 필수)와 짝이 안 되므로 키를 만들지 않는다. */
export function assignmentKey(studentId: string, date: string, classId: string): string {
  return `${studentId}|${date}|${classId}`;
}

/** 그 수업(날짜·반)의 영상 과제 표시 — true/false, 모르면 null. */
export function assignmentOf(
  assignments: VideoHomeworkAssignments | null | undefined,
  studentId: string,
  date: string | null | undefined,
  classId: string,
): boolean | null {
  if (!assignments || !date) return null;
  const v = assignments[assignmentKey(studentId, date, classId)];
  return typeof v === "boolean" ? v : null;
}

/** 다음 수업 검사를 숨길까 — 명시적으로 '없음'일 때만. */
export function hidesNextCheck(
  assignments: VideoHomeworkAssignments | null | undefined,
  studentId: string,
  homeworkDate: string | null | undefined,
  classId: string,
): boolean {
  return assignmentOf(assignments, studentId, homeworkDate, classId) === false;
}

