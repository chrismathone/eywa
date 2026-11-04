import type { WithdrawalReport } from "./model";

/**
 * 작성자가 둘 이상이면 DB가 보고서를 담임별로 나눠, 작성 강사가 없는 같은 과목 반은 어느 보고서에도 안 실린다(종료는 그룹이 한다).
 * 그 반을 같은 과목 보고서에 붙인다 — 미발송 반·다른 메인반도 메인 보고서의 반 칸·출결·수납에 들어간다(원장 2026-10-30 '귀속').
 */
export function withUnassignedCourses(
  report: Pick<WithdrawalReport, "snapshot" | "enrollment_ids" | "subjects">,
  group: { enrollment_ids: readonly string[] | null; teacher_ids: readonly string[] },
) {
  const unassigned = report.snapshot.courses.filter(c => group.enrollment_ids?.includes(c.id) && report.subjects.includes(c.subject)
    && !(c.teacherId && group.teacher_ids.includes(c.teacherId)));
  return [...new Set([...(report.enrollment_ids ?? []), ...unassigned.map(c => c.id)])];
}

/** 수강 ID가 없는 이전 보고서만 당시 과목·담임 범위를 사용한다. */
export function reportCourses(report: Pick<WithdrawalReport, "snapshot" | "enrollment_ids" | "subjects" | "group_id" | "teacher_id">) {
  return report.snapshot.courses.filter(c => report.enrollment_ids != null
    ? report.enrollment_ids.includes(c.id)
    : report.subjects.includes(c.subject) && (!report.group_id || c.teacherId === report.teacher_id));
}
