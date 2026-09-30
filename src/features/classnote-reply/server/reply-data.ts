import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { personalBoardSubject, workerReadyForReplies, type ReplyStatus } from "../reply-policy";
import { currentClassIds, type EnrollmentRow } from "../reply-eligibility-rule";

/**
 * 학부모 답글(0317a) — 서버 액션·면이 쓰는 조회(동기 export가 있어 `"use server"` 파일 밖, [[#119]]).
 * 🔴 admin(service_role)이라 RLS를 우회한다 — **모든 조회에 tenant_id 필터**([[#104]]).
 */
type Admin = ReturnType<typeof createAdminClient>;

/** 표가 없다(0317a 적용 전, [[#95]]) — PostgREST PGRST205 / Postgres 42P01. */
export function isMissingReplyTable(e: unknown): boolean {
  const o = e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {};
  return o.code === "42P01" || o.code === "PGRST205" || (typeof o.message === "string" && /classnote_parent_replies/.test(o.message) && /does not exist|schema cache/.test(o.message));
}

/**
 * 답글 표가 있나(0317a 적용됨). 🔴 `head: true`(HEAD)로 묻지 말 것 — 표가 없을 때 PostgREST는 본문 없는 404를 주고
 * postgrest-js는 그걸 **error 없는 204**로 바꾼다(빈 본문 404 우회 처리). 그러면 "표 있음"으로 읽혀 0317a 전에 버튼이 선다([[#95]]).
 * 한 줄을 실제로 GET해서 오류(PGRST205)를 받는다.
 */
export async function replyTableReady(admin: Admin, tenantId: string): Promise<boolean> {
  const { error } = await admin.from("classnote_parent_replies").select("id").eq("tenant_id", tenantId).limit(1);
  return !error;
}

/** 같은 글에 살아 있는(대기·처리 중·게시됨·수정/삭제 대기) 다른 답글 — 본문과 **수정 대기 본문**(같아지면 유니크에 걸린다). */
export async function liveBodiesOnPost(admin: Admin, tenantId: string, postId: number): Promise<{ id: string; body: string; pendingBody: string | null }[]> {
  const { data, error } = await admin.from("classnote_parent_replies").select("id, body, pending_body").eq("tenant_id", tenantId)
    .eq("classnote_post_id", postId).in("status", ["queued", "processing", "success", "edit_requested", "delete_requested"]);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as string, body: String(r.body ?? ""), pendingBody: (r.pending_body as string | null) ?? null }));
}

export type ParentMessage = {
  id: string; source: "post" | "comment"; classnotePostId: number; classnoteCommentId: number | null; childId: number | null;
  studentId: string | null; boardName: string | null; content: string; postedAt: string | null;
};

const MSG_COLS = "id, source, classnote_post_id, classnote_comment_id, child_id, student_id, class_name, content, posted_at";
export function toMessage(r: Record<string, unknown>): ParentMessage {
  return {
    id: String(r.id), source: r.source === "comment" ? "comment" : "post", classnotePostId: Number(r.classnote_post_id),
    classnoteCommentId: r.classnote_comment_id == null ? null : Number(r.classnote_comment_id), childId: r.child_id == null ? null : Number(r.child_id),
    studentId: (r.student_id as string | null) ?? null, boardName: (r.class_name as string | null) ?? null, content: String(r.content ?? ""),
    postedAt: (r.posted_at as string | null) ?? null,
  };
}

export async function loadMessage(admin: Admin, tenantId: string, messageId: string): Promise<ParentMessage | null> {
  const { data, error } = await admin.from("classnote_parent_messages").select(MSG_COLS).eq("tenant_id", tenantId).eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data ? toMessage(data as Record<string, unknown>) : null;
}

export async function loadMessagesByPosts(admin: Admin, tenantId: string, postIds: number[]): Promise<ParentMessage[]> {
  const ids = [...new Set(postIds)].map(String);
  const rows = await fetchInChunks<Record<string, unknown>>(ids, (chunk) =>
    admin.from("classnote_parent_messages").select(MSG_COLS).eq("tenant_id", tenantId).in("classnote_post_id", chunk),
  );
  return rows.map(toMessage);
}

export type ReplyRow = {
  id: string; messageId: string | null; classnotePostId: number; authorUserId: string | null; authorLabel: string; body: string;
  pendingBody: string | null; status: ReplyStatus; processingAction: string | null; error: string | null; errorRaw: string | null;
  failedAction: string | null; commentId: number | null; editedAt: string | null; createdAt: string; editHistory: { body: string; replaced_at: string }[];
};
const REPLY_COLS =
  "id, message_id, classnote_post_id, author_user_id, author_label, body, pending_body, status, processing_action, error, error_raw, failed_action, classnote_comment_id, edited_at, created_at, edit_history";
export function toReply(r: Record<string, unknown>): ReplyRow {
  return {
    id: String(r.id), messageId: (r.message_id as string | null) ?? null, classnotePostId: Number(r.classnote_post_id),
    authorUserId: (r.author_user_id as string | null) ?? null, authorLabel: String(r.author_label ?? ""), body: String(r.body ?? ""),
    pendingBody: (r.pending_body as string | null) ?? null, status: r.status as ReplyStatus, processingAction: (r.processing_action as string | null) ?? null,
    error: (r.error as string | null) ?? null, errorRaw: (r.error_raw as string | null) ?? null, failedAction: (r.failed_action as string | null) ?? null,
    commentId: r.classnote_comment_id == null ? null : Number(r.classnote_comment_id), editedAt: (r.edited_at as string | null) ?? null,
    createdAt: String(r.created_at), editHistory: Array.isArray(r.edit_history) ? (r.edit_history as ReplyRow["editHistory"]) : [],
  };
}

export async function loadRepliesForMessages(admin: Admin, tenantId: string, messageIds: string[]): Promise<ReplyRow[]> {
  const rows = await fetchInChunks<Record<string, unknown>>(messageIds, (chunk) =>
    admin.from("classnote_parent_replies").select(REPLY_COLS).eq("tenant_id", tenantId).in("message_id", chunk).order("created_at"),
  );
  return rows.map(toReply);
}

export async function loadReply(admin: Admin, tenantId: string, replyId: string): Promise<ReplyRow | null> {
  const { data, error } = await admin.from("classnote_parent_replies").select(REPLY_COLS).eq("tenant_id", tenantId).eq("id", replyId).maybeSingle();
  if (error) throw error;
  return data ? toReply(data as Record<string, unknown>) : null;
}

/**
 * 답글을 받을 연동 PC가 있나(심장박동 + 실게시 + `caps.parentReply`). 조회 실패 = 없다고 본다.
 * 🔧 개발 서버 한정 우회 — `CLASSNOTE_REPLY_DEV_WORKER=1` + NODE_ENV≠production이면 통과(개발 PC 1회 실행 스크립트로 처리하는 시험용).
 *    프로덕션 빌드에선 이 값을 절대 읽지 않는다.
 */
export async function workerAcceptsReplies(admin: Admin, tenantId: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env.CLASSNOTE_REPLY_DEV_WORKER === "1") return true;
  const { data, error } = await admin.from("classnote_workers").select("last_seen, last_results").eq("tenant_id", tenantId);
  if (error) return false;
  return workerReadyForReplies((data ?? []) as { last_seen: string | null; last_results: unknown }[], Date.now());
}

const MATH_KEYS = ["math", "subject_1"];
const LABEL_KEYS: Record<string, string[]> = { 수학: MATH_KEYS, 영어: ["english"] };

/**
 * 보드 → 과목 키·(반 보드면) 반. 1인 보드 `(수학)…`·테스트 보드 `[수학] …` = 라벨로, 반 보드 = 0302a 연결의 반 과목.
 * 모르면 keys 빈 배열(= 그 과목 담당으로 판정할 수 없다 → 관리자급만 답한다).
 */
export async function resolveBoard(admin: Admin, tenantId: string, boardName: string | null): Promise<{ keys: string[]; classId: string | null; className: string | null }> {
  const name = (boardName ?? "").trim();
  const label = personalBoardSubject(name) ?? /^\[([^\]]+)\]/.exec(name)?.[1]?.trim() ?? null;
  const fallback = { keys: (label && LABEL_KEYS[label]) || [], classId: null, className: null };
  if (!name || label) return fallback; // `(과목)`·`[과목]` 모양은 반 보드로 쓰지 않는다(class-board-plan reservedBoardName)
  const { data: links } = await admin.from("classnote_class_boards").select("class_id").eq("tenant_id", tenantId).eq("board_name", name).limit(2);
  if ((links ?? []).length !== 1) return fallback; // 없거나 이름이 겹치면 반을 짐작하지 않는다
  const classId = links![0]!.class_id as string;
  const { data: cls } = await admin.from("classes").select("class_name, subject").eq("tenant_id", tenantId).eq("id", classId).maybeSingle();
  const s = (cls?.subject as string | null) ?? null;
  if (!s) return fallback;
  return { keys: MATH_KEYS.includes(s) ? MATH_KEYS : [s], classId, className: (cls?.class_name as string | null) ?? null };
}

/**
 * 1인 보드 학생의 '반 이름' — 그 과목 **오늘 다니는** 반 중 내가 맡은 반, 없으면 유일한 반, 여럿이면 null(과목 라벨로).
 * 🔴 `end_date is null`만 보면 아직 시작 안 한 반이 들어오고 퇴원 예약(미래 종료) 반이 빠진다 — 학부모가 보는 명의에
 *    아직 안 다니는 반 이름이 나간다. 벨 수신자와 같은 판정(`currentClassIds`)으로 고른다.
 */
export async function studentClassForAuthor(
  admin: Admin,
  a: { tenantId: string; studentId: string | null; userId: string; keys: string[]; today: string },
): Promise<string | null> {
  if (!a.studentId || !a.keys.length) return null;
  const { data: enr } = await admin.from("enrollments").select("class_id, start_date, end_date, is_transferred").eq("tenant_id", a.tenantId).eq("student_id", a.studentId);
  const ids = currentClassIds((enr ?? []) as EnrollmentRow[], a.today);
  if (!ids.length) return null;
  const { data: cls } = await admin.from("classes").select("id, class_name, teacher_id").eq("tenant_id", a.tenantId).eq("is_active", true).in("subject", a.keys).in("id", ids);
  const list = (cls ?? []) as { id: string; class_name: string | null; teacher_id: string | null }[];
  const mine = list.filter((c) => c.teacher_id === a.userId);
  const pick = mine.length === 1 ? mine[0] : list.length === 1 ? list[0] : null;
  return pick?.class_name?.trim() || null;
}
