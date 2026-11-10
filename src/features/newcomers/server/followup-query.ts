import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant, accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday, kstDateOf } from "@/lib/date-kst";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { sectionResult } from "@/features/students/ontology/live-contract";
import { getNewcomers, loadNewcomers, type NewcomersView } from "./queries";
import { CONDITIONS, FOLLOWUP_STAGES, resolveSubjectManager, type ManagerAssignment, type ManagerDefault, type FollowupReport, type FollowupView, type Homeroom, type CheckEvidence } from "../followup-model";

export async function followupAccess() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !await canAccessTenant(user.systemRole, "newcomers")) throw Error("신입생 관리 권한이 없습니다");
  const scoped = user.systemRole === "teacher" || await accessLevelTenant(user.systemRole, "newcomers") === "scoped";
  const canReport = !user.tenantView && await canWriteTenant(user.systemRole, "newcomers");
  const canManage = !scoped && canReport;
  return { user, canManage, canReport, scoped };
}

/** 미해결 보고는 90일이 지나도 남기고 학생ID로 과거 기록도 다시 연다. */
export async function getFollowupSource(studentId?: string) {
  const { user } = await followupAccess();
  try {
    const db = createAdminClient();
    const open = await fetchAllPaged<{ student_id: string }>((a, b) => db.from("student_onboarding_feedback")
      .select("student_id").eq("tenant_id", user.tenantId)
      .or("review_state.neq.confirmed,and(next_due.not.is.null,followup_at.is.null)").order("id").range(a, b));
    const ids = [...new Set([...open.map(r => r.student_id), ...(z.uuid().safeParse(studentId).success ? [studentId!] : [])])];
    return await loadNewcomers(await createClient(), kstToday(), user.tenantId, ids);
  } catch { return { ...await getNewcomers(), followupError: "90일 이후 후속 관리 자료를 불러오지 못했습니다." }; }
}

/** 실제 담당 반과 기간으로 연결한다. 종료된 반이나 보강 대기 반은 담당자로 세지 않는다. */
export async function loadHomerooms(tenantId: string, ids: string[], today: string) {
  const db = createAdminClient();
  const enrolled = await fetchAllPagedInChunks<{ student_id: string; class_id: string; start_date: string; end_date: string | null; is_transferred: boolean }>(ids,
    (chunk, a, b) => db.from("enrollments").select("student_id,class_id,start_date,end_date,is_transferred").eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(a, b));
  const classes = await fetchInChunks<{ id: string; subject: string; teacher_id: string | null; is_active: boolean; closed_at: string | null; is_makeup_pool: boolean }>([...new Set(enrolled.map(e => e.class_id))],
    chunk => db.from("classes").select("id,subject,teacher_id,is_active,closed_at,is_makeup_pool").eq("tenant_id", tenantId).in("id", chunk));
  const classMap = new Map(classes.map(c => [c.id, c]));
  const people = await fetchInChunks<{ id: string; display_name: string }>([...new Set(classes.flatMap(c => c.teacher_id ? [c.teacher_id] : []))],
    chunk => db.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  const names = new Map(people.map(p => [p.id, p.display_name]));
  const result = new Map<string, Homeroom[]>();
  for (const e of enrolled) {
    const c = classMap.get(e.class_id);
    if (!c || !c.teacher_id || !c.is_active || c.is_makeup_pool || (c.closed_at && c.closed_at < today) || isEnrollmentEndedOn(e.end_date, today, e.is_transferred)) continue;
    const list = result.get(e.student_id) ?? [];
    const upcoming = e.start_date > today;
    const old = list.find(t => t.id === c.teacher_id && t.subject === c.subject);
    if (old) old.upcoming = old.upcoming && upcoming;
    else list.push({ id: c.teacher_id, name: names.get(c.teacher_id) ?? "담임 확인 필요", subject: c.subject, upcoming });
    result.set(e.student_id, list);
  }
  return result;
}

const REPORT_FIELDS = "id,student_id,subject,stage,author_id,condition,summary,response,next_action,next_due,created_at,review_state,review_note,reviewed_by,reviewed_at,followup_result,followup_at,followup_by,version";
type StoredReport = Omit<FollowupReport, "authorName" | "reviewerName" | "followupName">;
export async function loadFollowupReports(tenantId: string, ids: string[]): Promise<FollowupReport[]> {
  const db = createAdminClient();
  const rows = await fetchAllPagedInChunks<StoredReport>(ids, (chunk, a, b) => db.from("student_onboarding_feedback").select(REPORT_FIELDS)
    .eq("tenant_id", tenantId).in("student_id", chunk).order("created_at", { ascending: false }).order("id").range(a, b));
  const people = await fetchInChunks<{ id: string; display_name: string }>([...new Set(rows.flatMap(r => [r.author_id, r.reviewed_by, r.followup_by].filter((id): id is string => !!id)))],
    chunk => db.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  const names = new Map(people.map(p => [p.id, p.display_name]));
  return rows.map(r => ({ ...r, followupName: r.followup_by ? names.get(r.followup_by) ?? "처리자 확인 필요" : null, authorName: names.get(r.author_id) ?? "작성자 확인 필요", reviewerName: r.reviewed_by ? names.get(r.reviewed_by) ?? "확인자 정보 없음" : null }));
}

export async function getFollowupView(source: NewcomersView): Promise<{ data: FollowupView; legacy: NewcomersView }> {
  const { user, canManage, canReport, scoped } = await followupAccess();
  const db = createAdminClient(), tenant = user.tenantId;
  const homerooms = await loadHomerooms(tenant, source.rows.map(s => s.studentId), source.today);
  const rows = source.rows.filter(s => !scoped || homerooms.get(s.studentId)?.some(t => t.id === user.id)).map(row => {
    if (!scoped) return row;
    const mine = source.subjectRows.filter(s => s.studentId === row.studentId && homerooms.get(row.studentId)?.some(t => t.id === user.id && t.subject === s.subject));
    return { ...row, subjects: mine, checks: mine[0]?.checks ?? {}, checkDetails: mine[0]?.checkDetails, progress: mine[0]?.progress ?? row.progress };
  });
  const ids = rows.map(s => s.studentId), visible = new Set(ids);
  const legacy = { ...source, rows, subjectRows: source.subjectRows.filter(s => visible.has(s.studentId) && (!scoped || homerooms.get(s.studentId)?.some(t => t.id === user.id && t.subject === s.subject))) };
  const base: FollowupView = { today: source.today, actorId: user.id, canManage, canReport,
    checksKnown: source.checksAvailable && !source.checksError, staff: [], students: [], error: null };
  try {
    if (source.followupError) throw Error(source.followupError);
    const [reports, staff, checks, promises, subjectAssignments, defaults] = await Promise.all([
      loadFollowupReports(tenant, ids),
      fetchAllPaged<{ id: string; display_name: string; status: string; system_role: string }>((a, b) => db.from("users").select("id,display_name,status,system_role").eq("tenant_id", tenant).order("id").range(a, b)),
      fetchAllPagedInChunks<{ student_id: string; subject: string; item_key: string; done_by: string | null; memo: string | null; consultation_id: string | null }>(ids,
        (chunk, a, b) => db.from("student_onboarding_checks").select("student_id,subject,item_key,done_by,memo,consultation_id").eq("tenant_id", tenant).in("student_id", chunk).order("id").range(a, b)),
      fetchAllPagedInChunks<{ student_id: string; owner_id: string }>(ids, (chunk, a, b) => db.from("student_care_commitments").select("student_id,owner_id").eq("tenant_id", tenant).in("student_id", chunk).eq("state", "open").order("id").range(a, b)),
      fetchInChunks<ManagerAssignment>(ids, chunk => db.from("student_onboarding_subject_assignments").select("student_id,subject,manager_id,mode,version").eq("tenant_id",tenant).in("student_id",chunk)),
      fetchAllPaged<ManagerDefault>((a,b)=>db.from("student_onboarding_manager_defaults").select("subject,manager_id").eq("tenant_id",tenant).order("subject").range(a,b)),
    ]);
    const names = new Map(staff.map(p => [p.id, p.display_name]));
    const managers = staff.filter(p => p.status === "active" && ["master", "admin", "manager", "counselor"].includes(p.system_role)).map(p => ({ id: p.id, name: p.display_name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    base.staff = canManage ? managers : [];
    base.defaults=defaults.map(d=>({subject:d.subject,manager:managers.find(p=>p.id===d.manager_id)??null}));
    base.students = rows.map(row => {
      const subjects = legacy.subjectRows.filter(s => s.studentId === row.studentId);
      const evidence: Record<string, CheckEvidence> = {};
      for (const s of subjects) for (const check of checks.filter(c => c.student_id === row.studentId && (!c.subject || c.subject === s.subject)).sort((a, b) => Number(!!a.subject) - Number(!!b.subject))) {
        evidence[`${s.subject ?? ""}|${check.item_key}`] = { doneBy: check.done_by, doneByName: check.done_by ? names.get(check.done_by) ?? "처리자 확인 필요" : null, memo: check.memo, consultationId: check.consultation_id };
      }
      return { row, subjects, homerooms: (homerooms.get(row.studentId) ?? []).filter(t => !scoped || t.id === user.id),
        managers: subjects.map(s=>resolveSubjectManager(s.subject??"",subjectAssignments.find(a=>a.student_id===row.studentId&&a.subject===(s.subject??"")),defaults,managers)),
        evidence, reports: reports.filter(r => r.student_id === row.studentId && (!scoped || subjects.some(s => s.subject === r.subject))),
        openPromises: promises.filter(p => p.student_id === row.studentId && (!scoped || p.owner_id === user.id)).length };
    });
  } catch {
    base.error = source.followupError ?? "담당 배정·피드백 자료를 불러오지 못했습니다. 아래 완료 체크표에서 기존 기록을 확인하거나 다시 조회해 주세요.";
    base.canManage = false; base.canReport = false;
    base.students = rows.map(row => ({ row, subjects: legacy.subjectRows.filter(s => s.studentId === row.studentId), homerooms: (homerooms.get(row.studentId) ?? []).filter(t => !scoped || t.id === user.id), managers: [], evidence: {}, reports: [], openPromises: null }));
  }
  return { data: base, legacy };
}

/** 학생 통합 화면과 지식그래프도 같은 원본을 읽는다. 90일이 지나도 피드백은 남는다. */
export async function studentOnboardingSection(studentId: string) {
  const { user, scoped } = await followupAccess();
  const homerooms = await loadHomerooms(user.tenantId, [studentId], kstToday());
  const mine = (homerooms.get(studentId) ?? []).filter(t => t.id === user.id).map(t => t.subject);
  const reports = (await loadFollowupReports(user.tenantId, [studentId])).filter(r => !scoped || mine.includes(r.subject));
  const href = `/newcomers?student=${studentId}`;
  return { ...sectionResult("onboardingFeedback", "신입생 적응·담임 피드백", href, reports.map(r => ({ id: r.id, title: `${FOLLOWUP_STAGES[r.stage]} · ${CONDITIONS[r.condition]} · ${r.authorName}`, date: kstDateOf(r.created_at) ?? undefined, subject: r.subject,
    detail: `${r.summary}${r.response ? ` / 보완 보고: ${r.response}` : ""}${r.next_action ? ` / 후속: ${r.next_action} (${r.next_due})` : ""}${r.review_note ? ` / 관리자 확인: ${r.review_note}` : ""}${r.followup_result ? ` / 조치 결과: ${r.followup_result}` : ""}`,
    evidence: [{ source: "student_onboarding_feedback", id: r.id, studentId, href }] })), reports.length), note: "담임 관찰·관리자 확인·후속 처리 기록입니다. 보고자의 관찰이며 자동 성과 평가가 아닙니다." };
}
