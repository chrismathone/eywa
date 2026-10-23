import { canRequestReport, type CourseSnapshot, type StaffOption } from "./model";

/** 작성자를 생략한 반도 종료하므로 승인자는 종료 대상 전체 과목에서 고른다. */
export function requestManagers(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  subjects: readonly string[],
  teacherIds: readonly string[],
  directorIds: readonly string[] = [],
) {
  const hasAuthor = courses.some(c => c.teacherId && teacherIds.includes(c.teacherId));
  const authorSubjects = new Set(hasAuthor ? courses.filter(c => subjects.includes(c.subject)).map(c => c.subject) : []);
  return staff.filter(u => canRequestReport(u.role) && !teacherIds.includes(u.id) && !directorIds.includes(u.id)
    && (u.approvalSubjects ?? u.subjects).some(subject => authorSubjects.has(subject)));
}
