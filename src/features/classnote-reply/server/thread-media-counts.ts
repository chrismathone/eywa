import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { ParentMessage } from "./reply-data";
import { sanitizePhotos } from "./thread-data";
import { videoBelongsToThread } from "../thread-video";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * '학부모 글·답글' 면 한 줄에 붙일 첨부 개수 — 메시지 id → { 영상 N, 사진 M }. **개수만** 센다(주소는 싣지 않는다 → 열람 게이트 불필요).
 * 영상 = `student_homework_videos`(글: comment_id 없는 줄 · 댓글: 그 댓글 번호의 줄) · 사진 = 0326a 표의 주소 수.
 * 두 표가 없어도(0315a·0326a 전) 읽기가 실패해도 그 갈래만 0 — 면은 그대로 열려야 한다(#95).
 */
export async function countThreadMedia(admin: Admin, tenantId: string, messages: ParentMessage[]): Promise<Map<string, { videos: number; photos: number }>> {
  const out = new Map<string, { videos: number; photos: number }>();
  if (!messages.length) return out;
  const slot = (id: string) => out.get(id) ?? out.set(id, { videos: 0, photos: 0 }).get(id)!;
  const [vids, photos] = await Promise.all([
    fetchInChunks<{ post_id: number | null; comment_id: number | null; student_id: string | null }>([...new Set(messages.map((m) => String(m.classnotePostId)))], (chunk) =>
      admin.from("student_homework_videos").select("post_id, comment_id, student_id").eq("tenant_id", tenantId).in("post_id", chunk),
    ).catch(() => []),
    fetchInChunks<{ message_id: string; attachments: unknown }>(messages.map((m) => m.id), (chunk) =>
      admin.from("classnote_parent_message_attachments").select("message_id, attachments").eq("tenant_id", tenantId).in("message_id", chunk),
    ).catch(() => []),
  ]);
  for (const m of messages) {
    // 학생 판정은 답글 창과 같은 함수(videoBelongsToThread). 단 원문 행에 학생이 비어 있으면(반 보드 — 창은 보드 원아 매칭으로 학생을 정한다)
    // 여기선 그 학생을 모르므로 그 글의 영상을 다 센다.
    const mine = (v: { student_id: string | null }) => (m.studentId ? videoBelongsToThread(v.student_id, { studentId: m.studentId, allowUnmatched: m.childId != null }) : true);
    const n = vids.filter((v) => Number(v.post_id) === m.classnotePostId && mine(v) && (m.source === "post" ? v.comment_id == null : v.comment_id != null && Number(v.comment_id) === m.classnoteCommentId)).length;
    if (n) slot(m.id).videos = n;
  }
  // 사진 = 창에 실제로 뜨는 수(같은 거르기 sanitizePhotos — https·호스트·최대 10장).
  for (const p of photos) {
    const n = sanitizePhotos(p.attachments).length;
    if (n) slot(p.message_id).photos = n;
  }
  return out;
}
