import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { createAdminClient } from "@/lib/supabase/admin";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { REPLY_BODY_MAX } from "../reply-policy";
import type { ReplyContext } from "../reply-types";
import { toThreadVideo, type VideoRow } from "../thread-video";
import { canWatchThreadVideos } from "./thread-data";

/** 원문 복구 전에도 이미 보관된 영상은 같은 학생 열람 게이트로 보여 준다. 가짜 답글 대상을 저장하지 않는다. */
export async function archivedNotificationContext(admin: ReturnType<typeof createAdminClient>, user: CurrentUser, input: {
  notificationId: string; postId: number; type: string; body: string | null; link: string | null; createdAt: string | null;
}): Promise<ReplyContext> {
  const source = input.type === "classnote_parent_post" ? "post" : "comment";
  const commentId = /[?&]comment=(\d+)(?:&|#|$)/.exec(input.link ?? "")?.[1];
  const id = `notification:${input.notificationId}`;
  const content = input.body || "첨부된 학부모 글";
  let videos: ReturnType<typeof toThreadVideo>[] = [];
  if (source === "post" || commentId) {
    let query = admin.from("student_homework_videos").select("id, status, drive_file_id, uploaded_at, student_id")
      .eq("tenant_id", user.tenantId).eq("post_id", input.postId);
    query = source === "post" ? query.is("comment_id", null) : query.eq("comment_id", Number(commentId));
    const { data, error } = await query.order("created_at").limit(51);
    const rows = (data ?? []) as unknown as (VideoRow & { student_id: string | null })[];
    // 부분 조회·학생 불명·서로 다른 학생이 섞이면 주소를 내보내지 않는다.
    const studentId = rows[0]?.student_id;
    if (!error && rows.length <= 50 && studentId && rows.every((r) => r.student_id === studentId) && await canWatchThreadVideos(user, studentId)) {
      const teacherView = await effectiveTeacherId();
      videos = rows.map((r) => toThreadVideo(r, { canView: true, showDriveLink: !teacherView }));
    }
  }
  return {
    ok: true, message: { id, source, content, boardName: null, postedAt: input.createdAt },
    thread: [{ kind: "parent", messageId: id, source, content, postedAt: input.createdAt, focus: true, videos, photos: [], mediaNote: videos.length ? null : "첨부 원문을 확인하고 있습니다." }],
    canReply: false, reason: "이전 글의 답글 대상을 확인 중입니다. 연동 PC가 원문을 복구하면 이 창에서 답글을 쓸 수 있습니다.",
    authorLabel: null, workerReady: false, maxLength: REPLY_BODY_MAX, reaction: null, hideReaction: true, awaitingOriginal: true,
  };
}
