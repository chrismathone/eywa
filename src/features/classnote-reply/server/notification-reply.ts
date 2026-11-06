"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { commentNotificationAmbiguous, isParentMessageNotification, pickMessageForNotification, postIdFromClassnoteLink } from "../notification-match";
import type { ReplyContext } from "../reply-types";
import { loadMessagesByPosts } from "./reply-data";
import { replyGate, replyNotificationScope } from "./reply-gate";
import { getParentReplyContext } from "./reply-actions";
import { archivedNotificationContext } from "./archived-notification";

/** 목록의 버튼 조회가 끝나기 전·중앙 알림에서도 같은 창으로 진입. 알림 소유권과 원문 매칭은 서버에서 확인한다. */
export async function getNotificationReplyContext(notificationId: string): Promise<ReplyContext> {
  const g = await replyGate();
  if (!g.ok) return g;
  try {
    // 내 알림만 — 평소엔 세션(RLS), '다른 강사 뷰'면 대상 직원의 알림까지(지점·받는 사람 명시, replyNotificationScope).
    const scope = await replyNotificationScope(g.user);
    const { data: n, error } = await scope.db.from("notifications").select("type, link, body, created_at")
      .eq("tenant_id", g.user.tenantId).in("recipient_id", scope.recipients).eq("id", notificationId).maybeSingle();
    if (error || !n || !isParentMessageNotification(n.type)) return { ok: false, error: "알림을 찾지 못했습니다" };
    const postId = postIdFromClassnoteLink(n.link);
    if (!postId) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
    const messages = await loadMessagesByPosts(createAdminClient(), g.user.tenantId, [postId]);
    const note = { ...n, createdAt: n.created_at };
    const id = pickMessageForNotification(note, messages);
    if (!id) {
      if (g.mode !== "on" || !n.body?.includes("(내용 없이 첨부만)")) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
      return archivedNotificationContext(createAdminClient(), g.user, { notificationId, postId, ...note });
    }
    const hideReaction = commentNotificationAmbiguous(note, messages);
    const context = await getParentReplyContext(id, { noReaction: hideReaction });
    return context.ok ? { ...context, hideReaction } : context;
  } catch {
    return { ok: false, error: "답글 정보를 불러오지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }
}
