import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { REPLY_MODE, replyStatusView, replyTargetAllowed, type ReplyStatus } from "../reply-policy";
import type { ParentThreadRow, ParentThreadsView } from "../reply-types";
import { toMessage } from "./reply-data";

/**
 * 수업보고서 '학부모 글·답글' 면 — 최근 학부모 글·댓글(0184a 원문) + 답글 상태(0317a). 세션 클라이언트(RLS: 지점·직원만).
 * 답글 표가 없으면(0317a 전, [[#95]]) 글 목록만 보이고 답글 칸·버튼은 없다.
 */
export const PARENT_THREAD_DAYS = 14;
export const PARENT_THREAD_LIMIT = 100;

export async function listParentThreads(): Promise<ParentThreadsView> {
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
  const [replies, students] = await Promise.all([
    fetchInChunks<{ message_id: string; status: ReplyStatus; edited_at: string | null; error: string | null; failed_action: string | null; created_at: string }>(ids, (chunk) =>
      supabase.from("classnote_parent_replies").select("message_id, status, edited_at, error, failed_action, created_at").in("message_id", chunk),
    ).then((rows) => ({ ok: true as const, rows }), () => ({ ok: false as const, rows: [] })),
    fetchInChunks<{ id: string; name: string | null; classnote_name: string | null }>(studentIds, (chunk) =>
      supabase.from("students").select("id, name, classnote_name").in("id", chunk),
    ).catch(() => []),
  ]);
  const nameOf = new Map(students.map((s) => [s.id, (s.classnote_name || s.name || "").trim() || null]));
  const byMessage = new Map<string, typeof replies.rows>();
  for (const r of replies.rows) (byMessage.get(r.message_id) ?? byMessage.set(r.message_id, []).get(r.message_id)!).push(r);
  const rows = messages.map((m): ParentThreadRow => {
    const list = (byMessage.get(m.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = list[list.length - 1];
    const v = last ? replyStatusView({ status: last.status, editedAt: last.edited_at, error: last.error, failedAction: last.failed_action }) : null;
    return {
      messageId: m.id, source: m.source, boardName: m.boardName, studentName: m.studentId ? (nameOf.get(m.studentId) ?? null) : null,
      content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content, postedAt: m.postedAt,
      replyCount: list.filter((r) => r.status !== "deleted").length, latest: v ? { label: v.label, tone: v.tone } : null,
      replyable: replies.ok && replyTargetAllowed(REPLY_MODE, { boardName: m.boardName, childId: m.childId }).ok,
    };
  });
  return { rows, total: count ?? rows.length, days: PARENT_THREAD_DAYS, replyReady: replies.ok };
}
