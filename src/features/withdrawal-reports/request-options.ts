import { canRequestReport, type CourseSnapshot, type StaffOption } from "./model";

/** Approval candidates follow the selected authors' target courses, not their other teaching subjects. */
export function requestManagers(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  subjects: readonly string[],
  teacherIds: readonly string[],
  directorIds: readonly string[] = [],
) {
  const authorSubjects = new Set(courses.filter(c => c.teacherId && teacherIds.includes(c.teacherId) && subjects.includes(c.subject)).map(c => c.subject));
  return staff.filter(u => canRequestReport(u.role) && !teacherIds.includes(u.id) && !directorIds.includes(u.id)
    && (u.approvalSubjects ?? u.subjects).some(subject => authorSubjects.has(subject)));
}
