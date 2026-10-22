import type { WithdrawalReport } from "./model";

/** 수강 ID가 없는 이전 보고서만 당시 과목·담임 범위를 사용한다. */
export function reportCourses(report: Pick<WithdrawalReport, "snapshot" | "enrollment_ids" | "subjects" | "group_id" | "teacher_id">) {
  return report.snapshot.courses.filter(c => report.enrollment_ids != null
    ? report.enrollment_ids.includes(c.id)
    : report.subjects.includes(c.subject) && (!report.group_id || c.teacherId === report.teacher_id));
}
