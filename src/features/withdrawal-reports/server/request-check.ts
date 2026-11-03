import "server-only";
import { currentSnapshot, reportStaff, reportSubjectLabels } from "./queries";
import { reportApprovalPlan } from "../request-options";

export type ApprovalDecision =
  | { ok: true; byTeacher: Record<string, string[]>; managerIds: string[]; skipped: string[]; approvers: string[] }
  | { ok: false; error: string };

/**
 * 작성 요청의 **보고서마다 승인 관리자**를 서버가 정한다(원장 2026-11-03 *"작성 강사가 그 과목 관리자 본인이면 관리자 승인 생략"* — 보고서마다).
 * 요청 창과 **같은 계산**(`reportApprovalPlan` — 같은 직원 목록 `reportStaff`의 승인 과목 · 지금 학생 수강)으로:
 * - 생략 보고서 = 빈 목록(창이 무엇을 보냈든) · 그 밖 = 창이 보낸 그 보고서 목록(없으면 옛 화면의 `managerIds`) 중 **그 보고서 후보**만.
 * - 생략이 아닌데 남는 사람이 없으면 거절(그 보고서를 승인할 사람이 없다).
 * DB(s2_0020)는 역할로 다시 막는다(빈 목록 = 작성 강사가 관리자급일 때만 · 자기 자신 금지). 감사로그용 한 줄(생략 · 승인자)도 함께 만든다.
 */
export async function decideReportApprovals(tenantId: string, input: {
  studentId: string; teacherIds: string[]; subjects: string[]; enrollmentIds?: string[]; managerIds: string[]; reportManagerIds?: Record<string, string[]>;
}): Promise<ApprovalDecision> {
  const [staff, snapshot, labels] = await Promise.all([reportStaff(), currentSnapshot(tenantId, input.studentId), reportSubjectLabels()]);
  if (!snapshot) return { ok: false, error: "학생의 수강 정보를 확인하지 못했습니다." };
  const courses = snapshot.courses.filter(c => (input.enrollmentIds ? input.enrollmentIds.includes(c.id) : input.subjects.includes(c.subject)));
  const plan = reportApprovalPlan(staff, courses, input.teacherIds);
  const nameOf = (id: string) => staff.find(u => u.id === id)?.name ?? "이전 담당자";
  const subjectText = (subjects: string[]) => subjects.map(s => labels[s] ?? s).join("·");
  const byTeacher: Record<string, string[]> = {};
  const missing: string[] = [], skipped: string[] = [], approvers: string[] = [];
  for (const p of plan) {
    const wanted = input.reportManagerIds?.[p.teacherId] ?? input.managerIds;
    byTeacher[p.teacherId] = p.skip ? [] : p.candidates.filter(u => wanted.includes(u.id)).map(u => u.id);
    const head = `${nameOf(p.teacherId)} · ${subjectText(p.subjects)}`;
    if (p.skip) skipped.push(head);
    else if (byTeacher[p.teacherId].length) approvers.push(`${head} → ${byTeacher[p.teacherId].map(nameOf).join("·")}`);
    else missing.push(head);
  }
  if (missing.length) return { ok: false, error: `${missing.join(", ")} 보고서를 승인할 관리자를 선택해 주세요.` };
  const managerIds = [...new Set(Object.values(byTeacher).flat())];
  if (managerIds.length > 20) return { ok: false, error: "승인 관리자는 20명까지 정할 수 있습니다." };
  return { ok: true, byTeacher, managerIds, skipped, approvers };
}
