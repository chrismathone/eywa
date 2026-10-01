import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isReplyManager, replyBoardKnown, replyStatusView, replyTargetAllowed, type ReplyMode, type ReplyStatus } from "../reply-policy";
import type { ParentThreadRow, ParentThreadsView } from "../reply-types";
import { toMessage, uniqueClassBoardNames } from "./reply-data";
import { loadReactions, reactionReady, toReactionView, type ReactionRow } from "./reaction-data";

/**
 * 수업보고서 '학부모 글·답글' 면 — 최근 학부모 글·댓글(0184a 원문) + 답글 상태(0317a) + 공감 상태(0319a). 세션 클라이언트(RLS: 지점·직원만).
 * 답글 표가 없으면(0317a 전, [[#95]]) 글 목록만 보이고 답글 칸·버튼은 없다. 공감 표가 없거나 옛 워커면 공감 버튼이 없다.
 * 🔴 `mode`는 호출부(페이지)가 학원 설정에서 읽어 넘긴다 — 끔이면 이 면 자체가 없다(페이지가 세우지 않는다).
 */
export const PARENT_THREAD_DAYS = 14;
export const PARENT_THREAD_LIMIT = 100;

export async function listParentThreads(a: { mode: ReplyMode; user: CurrentUser }): Promise<ParentThreadsView> {
  const supabase = await createClient();
  const since = new Date(Date.now() - PARENT_THREAD_DAYS * 86_400_000).toISOString();
  const { data, count, error } = await supabase
    .from("classnote_parent_messages")
    .select("id, source, classnote_post_id, classnote_comment_id, child_id, student_id, class_name, content, posted_at", { count: "exact" })
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(PARENT_THREAD_LIMIT);
  if (error) throw error;
  const messages = (data ?? []).map((r) => toMessage(r as Record<string, unknown>));
  const ids = messages.map((m) => m.id);
  const studentIds = [...new Set(messages.map((m) => m.studentId).filter((x): x is string => !!x))];
  const admin = createAdminClient();
  const [replies, students, reactions, manager, readonly, classBoards] = await Promise.all([
    fetchInChunks<{ message_id: string; status: ReplyStatus; edited_at: string | null; error: string | null; failed_action: string | null; created_at: string }>(ids, (chunk) =>
      supabase.from("classnote_parent_replies").select("message_id, status, edited_at, error, failed_action, created_at").in("message_id", chunk),
    ).then((rows) => ({ ok: true as const, rows }), () => ({ ok: false as const, rows: [] })),
    fetchInChunks<{ id: string; name: string | null; classnote_name: string | null }>(studentIds, (chunk) =>
      supabase.from("students").select("id, name, classnote_name").in("id", chunk),
    ).catch(() => []),
    // 공감 — 표가 없거나(0319a 전) 공감을 아는 연동 PC가 없으면 null(버튼을 그리지 않는다).
    reactionReady(admin, a.user.tenantId)
      .then((ready) => (ready ? loadReactions(admin, a.user.tenantId, ids) : null))
      .catch((): Map<string, ReactionRow> | null => null),
    isReplyManager(a.user.systemRole) ? Promise.resolve(true) : isCurrentUserSuperAdmin().catch(() => false),
    readonlyTeacherViewError().then((r) => !!r, () => true),
    // 전체 모드 — aywa가 아는 보드(0302a 반 보드·1인 보드)의 글에만 버튼을 세운다(영어 그룹반 등은 어차피 받지 않는다).
    a.mode === "on" ? uniqueClassBoardNames(admin, a.user.tenantId, messages.map((m) => m.boardName)).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  const nameOf = new Map(students.map((s) => [s.id, (s.classnote_name || s.name || "").trim() || null]));
  const byMessage = new Map<string, typeof replies.rows>();
  for (const r of replies.rows) (byMessage.get(r.message_id) ?? byMessage.set(r.message_id, []).get(r.message_id)!).push(r);
  const rows = messages.map((m): ParentThreadRow => {
    const list = (byMessage.get(m.id) ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at));
    const last = list[list.length - 1];
    const v = last ? replyStatusView({ status: last.status, editedAt: last.edited_at, error: last.error, failedAction: last.failed_action }) : null;
    const target = replyTargetAllowed(a.mode, { boardName: m.boardName, childId: m.childId });
    const replyable = replies.ok && target.ok
      && replyBoardKnown({ mode: a.mode, testBoardId: target.boardId, boardIsClass: classBoards.has((m.boardName ?? "").trim()), boardName: m.boardName });
    return {
      messageId: m.id, source: m.source, boardName: m.boardName, studentName: m.studentId ? (nameOf.get(m.studentId) ?? null) : null,
      content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content, postedAt: m.postedAt,
      replyCount: list.filter((r) => r.status !== "deleted").length, latest: v ? { label: v.label, tone: v.tone } : null,
      replyable,
      reaction: replyable && reactions ? toReactionView(m.id, reactions.get(m.id) ?? null, a.user, manager, readonly) : null,
    };
  });
  return { rows, total: count ?? rows.length, days: PARENT_THREAD_DAYS, replyReady: replies.ok, testOnly: a.mode === "test" };
}
