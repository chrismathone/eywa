import "server-only";
import { currentSnapshot, reportStaff, reportSubjectLabels } from "./queries";
import { missingApproverNotice, reportApprovalPlan, reportAuthorIds } from "../request-options";

export type ApprovalDecision =
  | { ok: true; teacherIds: string[]; byTeacher: Record<string, string[]>; managerIds: string[]; skipped: string[]; approvers: string[] }
  | { ok: false; error: string };

/**
 * 작성 요청의 **작성 강사**와 **보고서마다 승인 관리자**를 서버가 정한다(원장 2026-11-03 *"작성 강사가 그 과목 관리자 본인이면 관리자 승인 생략"* — 보고서마다).
 * 요청 창과 **같은 계산**으로(화면이 보낸 작성 강사 명단은 믿지 않는다 — 리뷰 2026-11-03):
 * - 작성 강사 = 고른 반에서 과목마다 한 명(`reportAuthorIds` · 직원 목록에 있는 담임만 — 요청 창 `selectionFor`와 같다).
 * - 승인 = `reportApprovalPlan`(같은 직원 목록 `reportStaff`의 승인 과목 · 지금 학생 수강):
 * - 생략 보고서 = 빈 목록(창이 무엇을 보냈든) · 그 밖 = 창이 보낸 그 보고서 목록(없으면 옛 화면의 `managerIds`) 중 **그 보고서 후보**만.
 * - 생략이 아닌데 남는 사람이 없으면 거절(그 보고서를 승인할 사람이 없다).
 * DB(s2_0025)는 역할로 다시 막는다(빈 목록 = 작성 강사가 관리자급일 때만 · 자기 자신 금지). 감사로그용 한 줄(생략 · 승인자)도 함께 만든다.
 */
export async function decideReportApprovals(tenantId: string, input: {
  studentId: string; teacherIds: string[]; subjects: string[]; enrollmentIds?: string[]; managerIds: string[]; reportManagerIds?: Record<string, string[]>;
}): Promise<ApprovalDecision> {
  // forRequest — 학원 설정을 못 읽었으면 승인자를 정하지 않고 멈춘다(화면 자리와 달리 '아무도 지정 아님'으로 이어 가지 않는다).
  const [staff, snapshot, labels] = await Promise.all([reportStaff({ forRequest: true }), currentSnapshot(tenantId, input.studentId), reportSubjectLabels()]);
  if (!snapshot) return { ok: false, error: "학생의 수강 정보를 확인하지 못했습니다." };
  const courses = snapshot.courses.filter(c => (input.enrollmentIds ? input.enrollmentIds.includes(c.id) : input.subjects.includes(c.subject)));
  const authors = reportAuthorIds(courses.filter(c => staff.some(u => u.id === c.teacherId)));
  const teacherIds = staff.filter(u => authors.includes(u.id)).map(u => u.id);
  if (!teacherIds.length) return { ok: false, error: "선택한 반의 작성 강사를 찾지 못했습니다. 반의 담임 배정을 확인해 주세요." };
  const plan = reportApprovalPlan(staff, courses, teacherIds);
  // 지정 명단이 있는데 승인할 사람이 없는 보고서(유효한 지정자 없음 · 지정 승인자가 작성 강사 본인뿐) — 요청 창과 같은 판정·같은 글(리뷰 2026-11-06).
  const notice = plan.map(p => missingApproverNotice(staff, p)).find(Boolean);
  if (notice) return { ok: false, error: notice };
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
  return { ok: true, teacherIds, byTeacher, managerIds, skipped, approvers };
}
