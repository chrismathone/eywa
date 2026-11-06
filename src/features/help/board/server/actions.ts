"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { canAnswerHelpBoard, canAskHelpBoard } from "../access";
import { HELP_BOARD_NOT_READY, isMissingHelpBoard } from "../missing";
import { notifyHelpAnswer, notifyHelpQuestion } from "./notify";
import { logDbError } from "@/lib/supabase/db-error";

type Result = { ok: true; id: string } | { error: string };

/**
 * 이 요청의 행위자 — '다른 강사 뷰'면 **검증된 대상 X**(작성자 명의 · '자기 글' 판정 · 답변 역할이 전부 X 기준).
 * 🔴 관리 클라이언트로 쓰므로 읽기 강사뷰 · 지점 보기는 여기서 먼저 거절한다 — 답변 판정(canAnswerHelpBoard)은 총괄 우회가
 *    쓰기 게이트보다 앞에 있어 canWriteTenant 캡만으로는 다 막히지 않는다. 감사로그(logAction)는 실제 로그인 계정으로 남는다.
 */
// 반환 타입을 적는다 — 추론에 맡기면 `{ user }` 쪽에 `error?: undefined`가 붙어 `"error" in actor`로 좁혀지지 않는다.
type BoardActor = { error: string } | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> };
async function boardActor(): Promise<BoardActor> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  return { user };
}

function clip(s: string, max: number): string {
  return s.trim().slice(0, max);
}

export async function createHelpPost(form: { title: string; body: string }): Promise<Result> {
  const actor = await boardActor();
  if ("error" in actor) return { error: actor.error };
  const { user } = actor;
  if (!(await canAskHelpBoard(user.systemRole))) return { error: "질문을 작성할 권한이 없습니다" };
  const title = clip(form.title ?? "", 80);
  const body = clip(form.body ?? "", 4000);
  if (!title || !body) return { error: "제목과 내용을 적어 주세요" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("help_posts")
    .insert({ tenant_id: user.tenantId, author_id: user.id, title, body, status: "open" })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingHelpBoard(error)) return { error: HELP_BOARD_NOT_READY };
    return { error: "질문을 저장하지 못했습니다" };
  }
  const id = data?.id as string;
  await logAction({
    action: "help_post_create",
    targetType: "help_post",
    targetLabel: title,
    metadata: { postId: id, title },
  });
  await notifyHelpQuestion({ tenantId: user.tenantId, actorId: user.id, postId: id, title });
  revalidatePath("/help");
  return { ok: true, id };
}

export async function updateHelpPost(postId: string, form: { title: string; body: string }): Promise<Result> {
  const actor = await boardActor();
  if ("error" in actor) return { error: actor.error };
  const { user } = actor;
  if (!(await canAskHelpBoard(user.systemRole))) return { error: "질문을 수정할 권한이 없습니다" };
  const title = clip(form.title ?? "", 80);
  const body = clip(form.body ?? "", 4000);
  if (!title || !body) return { error: "제목과 내용을 적어 주세요" };
  const admin = createAdminClient();
  const { data: row, error: loadErr } = await admin
    .from("help_posts")
    .select("id, author_id, tenant_id")
    .eq("id", postId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (loadErr) {
    if (isMissingHelpBoard(loadErr)) return { error: HELP_BOARD_NOT_READY };
    return { error: "글을 찾지 못했습니다" };
  }
  if (!row) return { error: "글을 찾지 못했습니다" };
  if (row.author_id !== user.id) return { error: "자기 글만 고칠 수 있습니다" };
  const { error } = await admin.from("help_posts").update({ title, body }).eq("id", postId).eq("tenant_id", user.tenantId);
  if (error) {
    logDbError(error, "help.board.updateHelpPost");
    return { error: "수정하지 못했습니다" };
  }
  await logAction({
    action: "help_post_update",
    targetType: "help_post",
    targetLabel: title,
    metadata: { postId, title },
  });
  revalidatePath("/help");
  revalidatePath(`/help/posts/${postId}`);
  return { ok: true, id: postId };
}

export async function deleteHelpPost(postId: string): Promise<Result> {
  const actor = await boardActor();
  if ("error" in actor) return { error: actor.error };
  const { user } = actor;
  if (!(await canAskHelpBoard(user.systemRole))) return { error: "질문을 지울 권한이 없습니다" };
  const admin = createAdminClient();
  const { data: row, error: loadErr } = await admin
    .from("help_posts")
    .select("id, author_id, title, tenant_id")
    .eq("id", postId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (loadErr) {
    if (isMissingHelpBoard(loadErr)) return { error: HELP_BOARD_NOT_READY };
    return { error: "글을 찾지 못했습니다" };
  }
  if (!row) return { error: "글을 찾지 못했습니다" };
  if (row.author_id !== user.id) return { error: "자기 글만 지울 수 있습니다" };
  const { error } = await admin.from("help_posts").delete().eq("id", postId).eq("tenant_id", user.tenantId);
  if (error) {
    logDbError(error, "help.board.deleteHelpPost");
    return { error: "삭제하지 못했습니다" };
  }
  await logAction({
    action: "help_post_delete",
    targetType: "help_post",
    targetLabel: row.title as string,
    metadata: { postId, title: row.title as string },
  });
  revalidatePath("/help");
  return { ok: true, id: postId };
}

export async function createHelpAnswer(postId: string, bodyRaw: string): Promise<Result> {
  const actor = await boardActor();
  if ("error" in actor) return { error: actor.error };
  const { user } = actor;
  if (!(await canAnswerHelpBoard(user.systemRole))) return { error: "답변할 권한이 없습니다" };
  const body = clip(bodyRaw ?? "", 4000);
  if (!body) return { error: "답변을 적어 주세요" };
  const admin = createAdminClient();
  const { data: post, error: loadErr } = await admin
    .from("help_posts")
    .select("id, author_id, title, status, tenant_id")
    .eq("id", postId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (loadErr) {
    if (isMissingHelpBoard(loadErr)) return { error: HELP_BOARD_NOT_READY };
    return { error: "글을 찾지 못했습니다" };
  }
  if (!post) return { error: "글을 찾지 못했습니다" };
  if (post.status === "closed") return { error: "닫힌 글에는 답할 수 없습니다" };
  const { data, error } = await admin
    .from("help_answers")
    .insert({ tenant_id: user.tenantId, post_id: postId, author_id: user.id, body })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingHelpBoard(error)) return { error: HELP_BOARD_NOT_READY };
    return { error: "답변을 저장하지 못했습니다" };
  }
  if (post.status === "open") {
    await admin.from("help_posts").update({ status: "answered" }).eq("id", postId).eq("tenant_id", user.tenantId);
  }
  const id = data?.id as string;
  await logAction({
    action: "help_answer_create",
    targetType: "help_answer",
    targetLabel: post.title as string,
    metadata: { postId, answerId: id, title: post.title as string },
  });
  await notifyHelpAnswer({
    tenantId: user.tenantId,
    actorId: user.id,
    postId,
    authorId: post.author_id as string,
    title: post.title as string,
  });
  revalidatePath("/help");
  revalidatePath(`/help/posts/${postId}`);
  return { ok: true, id };
}

export async function closeHelpPost(postId: string): Promise<Result> {
  const actor = await boardActor();
  if ("error" in actor) return { error: actor.error };
  const { user } = actor;
  // 🔴 닫기도 쓰기다 — 작성자라도 도움말이 '읽기'면 닫지 못한다(전에는 메뉴 권한을 보지 않았다, 2026-11-05 권한 감사).
  if (!(await canAskHelpBoard(user.systemRole))) return { error: "이 글을 닫을 권한이 없습니다" };
  const admin = createAdminClient();
  const { data: post, error: loadErr } = await admin
    .from("help_posts")
    .select("id, author_id, title, tenant_id")
    .eq("id", postId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (loadErr) {
    if (isMissingHelpBoard(loadErr)) return { error: HELP_BOARD_NOT_READY };
    return { error: "글을 찾지 못했습니다" };
  }
  if (!post) return { error: "글을 찾지 못했습니다" };
  const canClose = post.author_id === user.id || (await canAnswerHelpBoard(user.systemRole));
  if (!canClose) return { error: "이 글을 닫을 권한이 없습니다" };
  const { error } = await admin
    .from("help_posts")
    .update({ status: "closed" })
    .eq("id", postId)
    .eq("tenant_id", user.tenantId);
  if (error) {
    logDbError(error, "help.board.closeHelpPost");
    return { error: "닫지 못했습니다" };
  }
  await logAction({
    action: "help_post_close",
    targetType: "help_post",
    targetLabel: post.title as string,
    metadata: { postId, title: post.title as string },
  });
  revalidatePath("/help");
  revalidatePath(`/help/posts/${postId}`);
  return { ok: true, id: postId };
}
