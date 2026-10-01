import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ThreadVideo } from "../reply-types";
import { decideReplyPermission } from "./reply-permission";
import { replyGate } from "./reply-gate";
import { loadMessage, loadMessagesByPosts } from "./reply-data";
import { loadThreadVideos, threadScope } from "./thread-data";

/**
 * 열려 있는 답글 창이 영상 보관 상태를 다시 확인할 때(GET 라우트) — 메시지 id → 그 글·댓글의 영상 목록.
 * 🔴 답글 창을 여는 것과 **같은 게이트**를 매번 다시 통과한다(모드 → 답글 자격 → 영상 열람 게이트). 통과 못 하면 빈 지도 —
 * 주소는 한 줄도 나가지 않는다. 같은 글·같은 원아의 메시지만 본다(쓰레드와 같은 범위).
 */
export async function getThreadVideoStates(messageId: string): Promise<Record<string, ThreadVideo[]>> {
  const g = await replyGate();
  if (!g.ok) return {};
  const admin = createAdminClient();
  const focus = await loadMessage(admin, g.user.tenantId, String(messageId)).catch(() => null);
  if (!focus) return {};
  const perm = await decideReplyPermission(admin, { user: g.user, manager: g.manager, message: focus, sendOn: g.sendOn, mode: g.mode });
  if (!perm.canReply) return {};
  const all = await loadMessagesByPosts(admin, g.user.tenantId, [focus.classnotePostId]);
  // 범위는 답글 창 조립과 같은 함수(threadScope) — 같은 글·같은 원아, 학생 미확정 영상 행의 취급까지 같다.
  const { messages, childKnown } = threadScope(all, focus);
  const { byMessage } = await loadThreadVideos(admin, { user: g.user, tenantId: g.user.tenantId, postId: focus.classnotePostId, studentId: perm.studentId ?? focus.studentId, messages, allowUnmatched: childKnown });
  return Object.fromEntries(byMessage);
}
