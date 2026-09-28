"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSuperAdminAction } from "@/features/super-admin/server/audit";
import { isMissingSupportTables, SUPPORT_NOT_READY } from "../missing";
import { asSupportStatus, isSupportStatus, SUPPORT_STATUS_META, type SupportStatus } from "../types";
import { notifySupportAnswer } from "./notify";

type Result = { ok: true; id: string } | { error: string };

/**
 * 슈퍼관리자 쓰기 — 개선요청 처리(상태·예정일·답변)와 공지사항. 🔴 모든 함수가 **첫 줄에서** `requireSuperAdmin()`.
 * 기록은 슈퍼관리자 감사 로그(`super_admin_audit_logs`)에 남긴다(지점 감사로그가 아니라 — 조치 주체가 운영자다).
 */
export async function answerSupportRequest(
  requestId: string,
  form: { status: string; dueDate: string; answer: string },
): Promise<Result> {
  const sa = await requireSuperAdmin();
  if (!isSupportStatus(form.status)) return { error: "처리상태를 골라 주세요" };
  const status: SupportStatus = form.status;
  const dueDate = (form.dueDate ?? "").trim();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { error: "예정일 형식을 확인해 주세요" };
  const answer = (form.answer ?? "").trim().slice(0, 8000);
  if (status === "done" && !answer) return { error: "완료로 바꾸려면 답변을 적어 주세요" };

  const admin = createAdminClient();
  const { data: before, error: loadErr } = await admin
    .from("support_requests")
    .select("id, tenant_id, author_id, title, status, answer")
    .eq("id", requestId)
    .maybeSingle();
  if (loadErr) return { error: isMissingSupportTables(loadErr) ? SUPPORT_NOT_READY : "글을 찾지 못했습니다" };
  if (!before) return { error: "글을 찾지 못했습니다" };

  const answerChanged = (before.answer ?? "") !== answer;
  const { data: saved, error } = await admin
    .from("support_requests")
    .update({
      status,
      due_date: dueDate || null,
      answer: answer || null,
      // 작성자 수정 잠금(author_locked_at)은 0296a 트리거가 찍는다 — 상태를 되돌리거나 답을 지워도 풀리지 않는다.
      ...(answerChanged ? { answered_by: sa.id, answered_at: answer ? new Date().toISOString() : null } : {}),
    })
    .eq("id", requestId)
    .select("id");
  if (error) return { error: "저장하지 못했습니다" };
  // 폼을 연 사이 작성자가 '접수' 글을 지웠으면 0행 — 저장된 척하거나 404 링크 알림을 보내지 않는다.
  if (!saved?.length) return { error: "글이 지워졌습니다 — 목록으로 돌아가 주세요" };

  const prevStatus = asSupportStatus(before.status);
  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "support_request_answer",
    targetTenantId: before.tenant_id as string,
    targetLabel: before.title as string,
    metadata: { requestId, status, prevStatus, dueDate: dueDate || null, answered: Boolean(answer) },
  });
  // 요청자에게 — 상태가 바뀌었거나 답변이 새로 달리거나 고쳐졌을 때만(예정일만 만진 저장은 조용히).
  if (prevStatus !== status || (answerChanged && answer)) {
    await notifySupportAnswer({
      tenantId: before.tenant_id as string,
      requestId,
      authorId: before.author_id as string,
      title: before.title as string,
      statusLabel: SUPPORT_STATUS_META[status].label,
    });
  }
  revalidatePath("/super-admin/support");
  revalidatePath(`/super-admin/support/${requestId}`);
  revalidatePath("/support");
  revalidatePath(`/support/requests/${requestId}`);
  return { ok: true, id: requestId };
}

export async function saveSupportNotice(
  noticeId: string | null,
  form: { title: string; body: string; pinned: boolean },
): Promise<Result> {
  const sa = await requireSuperAdmin();
  const title = (form.title ?? "").trim().slice(0, 120);
  const body = (form.body ?? "").trim().slice(0, 20000);
  if (!title || !body) return { error: "제목과 내용을 적어 주세요" };
  const row = { title, body, pinned: Boolean(form.pinned) };
  const admin = createAdminClient();
  const res = noticeId
    ? await admin.from("support_notices").update(row).eq("id", noticeId).select("id").maybeSingle()
    : await admin.from("support_notices").insert({ ...row, created_by: sa.id }).select("id").maybeSingle();
  if (res.error || !res.data) {
    if (isMissingSupportTables(res.error)) return { error: SUPPORT_NOT_READY };
    return { error: noticeId ? "공지를 찾지 못했습니다" : "공지를 저장하지 못했습니다" };
  }
  const id = res.data.id as string;
  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: noticeId ? "support_notice_update" : "support_notice_create",
    targetLabel: title,
    metadata: { noticeId: id, pinned: row.pinned },
  });
  revalidatePath("/super-admin/support/notices");
  revalidatePath("/support");
  revalidatePath(`/support/notices/${id}`);
  return { ok: true, id };
}

export async function deleteSupportNotice(noticeId: string): Promise<Result> {
  const sa = await requireSuperAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.from("support_notices").delete().eq("id", noticeId).select("id, title");
  if (error) return { error: isMissingSupportTables(error) ? SUPPORT_NOT_READY : "삭제하지 못했습니다" };
  if (!data?.length) return { error: "공지를 찾지 못했습니다" };
  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "support_notice_delete",
    targetLabel: data[0].title as string,
    metadata: { noticeId },
  });
  revalidatePath("/super-admin/support/notices");
  revalidatePath("/support");
  return { ok: true, id: noticeId };
}
