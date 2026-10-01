import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { REACTION_LABELS, canPressReaction, canRemoveReaction, isReactionType, reactionStatusView, type ReactionStatus } from "../reaction-policy";
import type { ReactionView } from "../reply-types";
import { workerAcceptsReplies } from "./reply-data";

/**
 * 학부모 글 공감(0319a) — 서버 액션·면이 쓰는 조회.
 * 🔴 admin(service_role)이라 RLS를 우회한다 — **모든 조회에 tenant_id 필터**([[#104]]).
 */
type Admin = ReturnType<typeof createAdminClient>;

/** 표가 없다(0319a 적용 전, [[#95]]) — PostgREST PGRST205 / Postgres 42P01. */
export function isMissingReactionTable(e: unknown): boolean {
  const o = e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {};
  return o.code === "42P01" || o.code === "PGRST205" || (typeof o.message === "string" && /classnote_parent_reactions/.test(o.message) && /does not exist|schema cache/.test(o.message));
}

/**
 * 공감 버튼을 세워도 되나 — 표가 있고(0319a) · 공감을 아는 연동 PC가 살아 있다(`caps.parentReaction`).
 * 🔴 표 유무를 `head: true`(HEAD)로 묻지 말 것 — 표가 없을 때의 빈 본문 404를 postgrest-js가 **error 없는 204**로 바꿔 "표 있음"으로
 *    읽힌다([[#95]] — 답글 `replyTableReady`와 같은 함정). 한 줄을 실제로 GET해서 오류(PGRST205)를 받는다.
 */
export async function reactionReady(admin: Admin, tenantId: string): Promise<boolean> {
  const [table, worker] = await Promise.all([
    admin.from("classnote_parent_reactions").select("id").eq("tenant_id", tenantId).limit(1),
    workerAcceptsReplies(admin, tenantId, "parentReaction"),
  ]);
  return !table.error && worker;
}

export type ReactionRow = {
  id: string; messageId: string; reactionType: string; authorUserId: string | null; authorLabel: string; status: ReactionStatus;
  processingAction: string | null; error: string | null; errorRaw: string | null; failedAction: string | null; reactionId: number | null;
  /** 누르기 요청이 나갔는데 결과를 확정하지 못했다(ClassNote에 눌려 있을 수 있다) */
  unconfirmed: boolean;
};
const COLS = "id, message_id, reaction_type, author_user_id, author_label, status, processing_action, error, error_raw, failed_action, classnote_reaction_id, unconfirmed";
function toRow(r: Record<string, unknown>): ReactionRow {
  return {
    id: String(r.id), messageId: String(r.message_id), reactionType: String(r.reaction_type ?? ""), authorUserId: (r.author_user_id as string | null) ?? null,
    authorLabel: String(r.author_label ?? ""), status: r.status as ReactionStatus, processingAction: (r.processing_action as string | null) ?? null,
    error: (r.error as string | null) ?? null, errorRaw: (r.error_raw as string | null) ?? null, failedAction: (r.failed_action as string | null) ?? null,
    reactionId: r.classnote_reaction_id == null ? null : Number(r.classnote_reaction_id), unconfirmed: r.unconfirmed === true,
  };
}

/** 메시지들의 공감 행(메시지당 하나). 표가 없거나 조회가 실패하면 던진다 — 호출부가 '공감 없음'으로 받는다. */
export async function loadReactions(admin: Admin, tenantId: string, messageIds: string[]): Promise<Map<string, ReactionRow>> {
  const rows = await fetchInChunks<Record<string, unknown>>([...new Set(messageIds)], (chunk) =>
    admin.from("classnote_parent_reactions").select(COLS).eq("tenant_id", tenantId).in("message_id", chunk),
  );
  return new Map(rows.map((r) => [String(r.message_id), toRow(r)]));
}

export async function loadReaction(admin: Admin, tenantId: string, messageId: string): Promise<ReactionRow | null> {
  const { data, error } = await admin.from("classnote_parent_reactions").select(COLS).eq("tenant_id", tenantId).eq("message_id", messageId).maybeSingle();
  if (error) throw error;
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** 행(없으면 null) → 화면용. `readonly` = '다른 강사 뷰'(열람 전용) — 누르기·풀기 버튼을 세우지 않는다. */
export function toReactionView(messageId: string, row: ReactionRow | null, user: CurrentUser, manager: boolean, readonly = false): ReactionView {
  if (!row) return { messageId, typeLabel: null, statusLabel: null, tone: "inert", pressed: false, busy: false, by: null, error: null, errorRaw: null, canPress: !readonly, canRemove: false };
  const v = reactionStatusView({ status: row.status, processingAction: row.processingAction, error: row.error, failedAction: row.failedAction, unconfirmed: row.unconfirmed });
  return {
    messageId, typeLabel: isReactionType(row.reactionType) ? REACTION_LABELS[row.reactionType] : null, statusLabel: v.label, tone: v.tone, pressed: v.pressed,
    busy: v.busy, by: row.authorLabel || null, error: row.error, errorRaw: row.errorRaw,
    canPress: !readonly && canPressReaction(row.status),
    canRemove: !readonly && canRemoveReaction({ userId: user.id, role: user.systemRole, manager, authorUserId: row.authorUserId, status: row.status, unconfirmed: row.unconfirmed }),
  };
}
