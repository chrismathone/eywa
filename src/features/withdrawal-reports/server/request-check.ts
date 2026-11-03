import "server-only";
import { currentSnapshot, reportStaff } from "./queries";
import { requestApprovers } from "../request-options";

/**
 * 승인 관리자 0명 요청이 맞는가 — 관리자 승인 생략(원장 2026-11-03 · 작성 강사가 모든 과목의 관리자)일 때만 받는다.
 * 요청 창과 **같은 계산**(`requestApprovers().skipAll`)을 서버가 지금 학생 수강·직원 목록으로 다시 한다(창을 거치지 않은 요청도 같은 답).
 * DB(s2_0020)는 작성 강사가 관리자급인지만 본다 — 과목 관리자인지는 여기서 가린다. 못 읽으면 false(요청을 막는다).
 */
export async function managerStepSkippable(tenantId: string, input: { studentId: string; teacherIds: string[]; subjects: string[]; enrollmentIds?: string[] }): Promise<boolean> {
  const [staff, snapshot] = await Promise.all([reportStaff(), currentSnapshot(tenantId, input.studentId)]);
  if (!snapshot) return false;
  const courses = snapshot.courses.filter(c => (input.enrollmentIds ? input.enrollmentIds.includes(c.id) : input.subjects.includes(c.subject)));
  return requestApprovers(staff, courses, [...new Set(courses.map(c => c.subject))], input.teacherIds).skipAll;
}
