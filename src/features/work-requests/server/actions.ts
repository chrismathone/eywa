"use server";

import { z } from "zod";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { sanitizeRichHtml } from "@/lib/html/sanitize";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { getStaffTaskViewer, type StaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { WORK_CATEGORIES, WORK_OUTCOMES, effectiveStudents, type WorkAction, type WorkDraft, type WorkOutcome, type WorkStatus } from "../model";
import { BODY_LIMIT, looksLikeHtml, richBodyText, trimRichBody } from "../rich-body";
import { canCreateWork } from "./board";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const draftSchema = z.object({
  category: z.enum(WORK_CATEGORIES),
  title: z.string().trim().min(1, "제목을 적어 주세요").max(120, "제목은 120자까지입니다"),
  body: z.string().max(BODY_LIMIT, "내용이 너무 깁니다 — 서식 포함 20,000자까지입니다"),
  criteria: z.string().max(1000, "완료 기준은 1,000자까지입니다"),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reviewerId: z.string().uuid().nullable(),
  assigneeIds: z.array(z.string().uuid()).min(1, "담당자를 한 명 이상 골라 주세요").max(30, "담당자는 30명까지입니다"),
  students: z.array(z.object({ id: z.string().uuid(), name: z.string(), assigneeId: z.string().uuid().nullable() })).max(300, "학생은 300명까지 이을 수 있습니다"),
  source: z.string().max(40).nullable(),
});

const actSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["ack", "report", "approve", "return", "cancel"]),
  outcome: z.enum(WORK_OUTCOMES as [WorkOutcome, ...WorkOutcome[]]).nullable(),
  note: z.string().max(2000, "2,000자까지 적을 수 있습니다").nullable(),
  targets: z.array(z.string().uuid()).max(30).nullable(),
});

async function gate(): Promise<{ ok: true; viewer: StaffTaskViewer } | { ok: false; error: string }> {
  const viewer = await getStaffTaskViewer();
  if (!viewer) return { ok: false, error: "이 계정으로는 업무 요청을 쓸 수 없습니다" };
  if (await isTenantViewWriteBlocked()) return { ok: false, error: "읽기 전용으로 보는 중에는 바꿀 수 없습니다" };
  // 사람이 '다른 강사 뷰'의 대상 강사일 수 있다(gate.ts) — '읽기' 강사뷰는 그 강사 명의로 쓰지 않는다.
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  return { ok: true, viewer };
}

const failText = (error: unknown) => explainDbError(error, { scope: "work-requests", fallback: "저장하지 못했습니다. 잠시 뒤 다시 해 주세요." }).message;

export async function createWorkRequest(input: WorkDraft): Promise<Result<{ id: string }>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요" };
  const g = await gate();
  if (!g.ok) return g;
  if (!canCreateWork(g.viewer)) return { ok: false, error: "업무 요청은 관리자가 만들 수 있습니다" };
  const d = parsed.data;
  // 🔴 서식 글(에디터 HTML)은 저장 전에 허용 목록으로 거른다 — 요청 내용은 담당자 · 검토자가 반드시 여는 글이다(저장형 XSS · 전자결재와 같은 규칙).
  //    글자 없는 서식(`<p></p>`)은 빈 내용으로 · 끝의 빈 문단은 뗀다.
  const html = looksLikeHtml(d.body);
  const clean = html ? trimRichBody(sanitizeRichHtml(d.body)) : d.body.trim();
  const body = html && !richBodyText(clean) ? "" : clean;
  const links = effectiveStudents(d.students, d.assigneeIds);
  if (body.length > BODY_LIMIT) return { ok: false, error: "내용이 너무 깁니다 — 서식 포함 20,000자까지입니다" };
  const { data, error } = await createAdminClient().rpc("work_request_create", {
    p_tenant: g.viewer.user.tenantId, p_actor: g.viewer.user.id, p_category: d.category, p_title: d.title, p_body: body, p_criteria: d.criteria,
    p_due: d.dueOn, p_reviewer: d.reviewerId, p_assignees: d.assigneeIds,
    // 학생마다 맡은 담당자 — 담당자 목록에서 빠진 사람이면 담당 미정(함수도 한 번 더 거른다) · 다른 담당자가 맡은 학생의 미정 줄은 뺀다.
    p_links: links.map((s) => ({ student: s.id, assignee: s.assigneeId })), p_source: d.source,
  });
  if (error || typeof data !== "string") return { ok: false, error: failText(error) };
  // 감사로그(기능 추가 · 변동은 모두) — 단계마다의 누가 · 언제 · 무엇을은 업무 요청의 사건 기록에도 남는다.
  await logAction({ action: "work_request_create", targetType: "work_request", targetLabel: d.title, metadata: { id: data, assignees: d.assigneeIds.length, students: new Set(links.map((s) => s.id)).size } });
  return { ok: true, data: { id: data } };
}

export async function actOnWorkRequest(input: { id: string; action: WorkAction; outcome: WorkOutcome | null; note: string | null; targets: string[] | null }): Promise<Result<{ status: WorkStatus }>> {
  const parsed = actSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요" };
  const g = await gate();
  if (!g.ok) return g;
  const d = parsed.data;
  // 누가 무엇을 할 수 있는지는 함수가 요청 행을 잠근 채 판정한다(담당자 · 검토자 · 요청자).
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("work_request_act", {
    p_tenant: g.viewer.user.tenantId, p_request: d.id, p_actor: g.viewer.user.id, p_action: d.action, p_outcome: d.outcome, p_note: d.note, p_targets: d.targets,
  });
  // 처리 뒤 지금 상태 · 제목(실패면 까닭을 고르고, 성공이면 감사로그 대상) — 요청 하나라 가볍다.
  const now = await admin.from("work_requests").select("title, status").eq("tenant_id", g.viewer.user.tenantId).eq("id", d.id).maybeSingle();
  if (error || typeof data !== "string") {
    // 다른 사람이 먼저 마감 · 취소했으면(낡은 화면에서 겹쳐 누름) 단계 문구 대신 그 사실을 알린다.
    const ended = now.data?.status === "closed" || now.data?.status === "cancelled";
    return { ok: false, error: ended ? "이미 마감되었거나 취소된 업무입니다." : failText(error) };
  }
  await logAction({ action: "work_request_act", targetType: "work_request", targetLabel: now.data?.title ?? null, metadata: { id: d.id, step: d.action, outcome: d.outcome, status: data } });
  return { ok: true, data: { status: data as WorkStatus } };
}
