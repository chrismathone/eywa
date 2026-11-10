"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { kstToday } from "@/lib/date-kst";
import { assignmentSchema, reportSchema, reviewSchema } from "../followup-model";
import { followupAccess, loadHomerooms } from "./followup-query";
import { studentTakesSubject } from "./consult-link";

const conflict = "다른 담당자가 먼저 수정했습니다. 새로고침한 뒤 다시 확인해 주세요.";
type SaveResult = { ok: true; error?: never } | { ok: false; error: string };
async function writeAccess(studentId: string) {
  const access = await followupAccess();
  if (!access.canReport) throw Error("피드백 작성 권한이 없습니다");
  if (access.user.tenantView || await readonlyTeacherViewError()) throw Error("현재 보기에서는 기록을 변경할 수 없습니다");
  const db = createAdminClient();
  const result = await db.from("students").select("id").eq("tenant_id", access.user.tenantId).eq("id", studentId).maybeSingle();
  if (result.error || !result.data) throw Error("학생 정보를 확인할 수 없습니다");
  const homerooms = await loadHomerooms(access.user.tenantId, [studentId], kstToday());
  const subjects = [...new Set((homerooms.get(studentId) ?? []).filter(t => t.id === access.user.id).map(t => t.subject))];
  if (!access.canManage && !subjects.length) throw Error("담당 학생의 피드백만 작성할 수 있습니다");
  const actor = await getCurrentUser();
  if (!actor || actor.tenantId !== access.user.tenantId) throw Error("로그인 정보를 확인해 주세요");
  return { ...access, db, subjects, homerooms, actorId: actor.id };
}
function refreshed(studentId: string) { revalidatePath("/newcomers"); revalidatePath(`/students/${studentId}`); }
const errorResult = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "저장하지 못했습니다. 다시 시도해 주세요." });

export async function assignNewcomerManager(input: unknown): Promise<SaveResult> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "학생과 관리 담당자를 확인해 주세요" };
  try {
    const { studentId, subject, mode, managerId, version } = parsed.data;
    const { user, canManage, db, actorId } = await writeAccess(studentId);
    if (!canManage) throw Error("관리 담당자를 지정할 권한이 없습니다");
    if (subject) {
      const takes = await studentTakesSubject(db,user.tenantId,studentId,subject);
      if (!takes.ok || !takes.takes) throw Error("학생의 수강 과목을 확인해 주세요");
    }
    if (managerId) {
      const person = await db.from("users").select("id").eq("tenant_id", user.tenantId).eq("id", managerId).eq("status", "active").in("system_role", ["master", "admin", "manager", "counselor"]).maybeSingle();
      if (person.error || !person.data) throw Error("현재 학원의 관리 담당자를 선택해 주세요");
    }
    const record = { tenant_id: user.tenantId, student_id: studentId, subject, mode, manager_id: managerId, updated_by: actorId, updated_at: new Date().toISOString(), version: version + 1 };
    const result = version === 0 ? await db.from("student_onboarding_subject_assignments").insert(record).select("version").single()
      : await db.from("student_onboarding_subject_assignments").update(record).eq("tenant_id", user.tenantId).eq("student_id", studentId).eq("subject",subject).eq("version", version).select("version").maybeSingle();
    if (result.error || !result.data) throw Error(result.error?.code === "23505" || !result.error ? conflict : "담당 배정을 저장하지 못했습니다");
    refreshed(studentId); return { ok: true as const };
  } catch (e) { return errorResult(e); }
}

export async function submitNewcomerFeedback(input: unknown): Promise<SaveResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "적응 상태·관찰 내용·후속 조치와 기한을 확인해 주세요" };
  try {
    const v = parsed.data;
    const { user, canManage, db, subjects, homerooms: rooms, actorId } = await writeAccess(v.studentId);
    if (!canManage && !subjects.includes(v.subject)) throw Error("본인이 담당하는 과목에만 보고할 수 있습니다");
    if (canManage && !(rooms.get(v.studentId) ?? []).some(t => t.subject === v.subject) && v.subject !== "general") {
      const takes = await studentTakesSubject(db,user.tenantId,v.studentId,v.subject);
      if (!takes.ok || !takes.takes) throw Error("수강 과목을 확인해 주세요");
    }
    const record = { id: v.id, tenant_id: user.tenantId, student_id: v.studentId, subject: v.subject, stage: v.stage, author_id: user.id,
      condition: v.condition, summary: v.summary, next_action: v.nextAction, next_due: v.nextDue, updated_by: actorId };
    const result = await db.from("student_onboarding_feedback").insert(record);
    if (result.error?.code === "23505") {
      const prior = await db.from("student_onboarding_feedback").select("id,author_id,student_id,subject,stage,condition,summary,next_action,next_due").eq("tenant_id", user.tenantId).eq("id", v.id).maybeSingle();
      if (prior.error || !prior.data || Object.entries(record).some(([key, value]) => !["tenant_id", "updated_by"].includes(key) && (prior.data as Record<string, unknown>)[key] !== value)) throw Error(conflict);
    } else if (result.error) throw Error("피드백을 저장하지 못했습니다");
    refreshed(v.studentId); return { ok: true as const };
  } catch (e) { return errorResult(e); }
}

export async function reviewNewcomerFeedback(input: unknown): Promise<SaveResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "확인 의견 또는 조치 결과를 입력해 주세요" };
  try {
    const v = parsed.data;
    const { user, canManage, db, subjects, actorId } = await writeAccess(v.studentId);
    const existing = await db.from("student_onboarding_feedback").select("id,author_id,subject,version,next_action,followup_at,review_state").eq("tenant_id", user.tenantId).eq("student_id", v.studentId).eq("id", v.id).maybeSingle();
    if (existing.error || !existing.data) throw Error("피드백을 찾을 수 없습니다");
    const old = existing.data;
    if (old.version !== v.version) throw Error(conflict);
    if (["confirmed","revision"].includes(v.operation) && !canManage) throw Error("관리자만 피드백을 확인할 수 있습니다");
    if (v.operation === "respond" && ((!canManage && (old.author_id !== user.id || !subjects.includes(old.subject))) || old.review_state !== "revision")) throw Error("보완 요청된 본인의 피드백에만 답변할 수 있습니다");
    if (v.operation === "resolve" && ((!canManage && (old.author_id !== user.id || !subjects.includes(old.subject))) || !old.next_action || old.followup_at)) throw Error("처리할 후속 조치가 없거나 처리 권한이 없습니다");
    const now = new Date().toISOString();
    const patch = v.operation === "respond" ? { response: v.note, review_state: "pending", review_note: "", reviewed_by: null, reviewed_at: null }
      : v.operation === "resolve" ? { followup_result: v.note, followup_at: now, followup_by: user.id }
      : { review_state: v.operation, review_note: v.note, reviewed_by: user.id, reviewed_at: now };
    const saved = await db.from("student_onboarding_feedback").update({ ...patch, version: v.version + 1, updated_by: actorId }).eq("tenant_id", user.tenantId).eq("student_id", v.studentId).eq("id", v.id).eq("version", v.version).select("id").maybeSingle();
    if (saved.error || !saved.data) throw Error(saved.error ? "확인 결과를 저장하지 못했습니다" : conflict);
    refreshed(v.studentId); return { ok: true as const };
  } catch (e) { return errorResult(e); }
}
