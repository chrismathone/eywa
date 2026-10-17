import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUploadEvent, uploadFailureText } from "../upload-diagnostics";
import { startedWhileLinkOpen } from "../upload-checks";
import { resolveSubmitToken } from "./links";
import { alreadyUploadedSameVideo } from "./upload-duplicate";

export async function recordUploadEvent(input: { token: unknown; uploadId: unknown; event: unknown }): Promise<number> {
  const event = parseUploadEvent(input.event);
  if (!event || typeof input.uploadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.uploadId)) return 400;
  try {
    const db = createAdminClient();
    const resolved = await resolveSubmitToken(db, input.token);
    if (resolved.state !== "ok" && resolved.state !== "expired") return 404;
    const link = resolved.link;
    const { data: upload, error } = await db.from("homework_video_link_uploads").select("bytes,created_at")
      .eq("tenant_id", link.tenant_id).eq("link_id", link.id).eq("id", input.uploadId).maybeSingle();
    if (error) return 503;
    if (!upload || !startedWhileLinkOpen(upload, link) || event.sentBytes > Number(upload.bytes)) return 404;
    const terminal = event.kind === "failed" || event.kind === "confirm_failed" || event.kind === "page_left";
    // 이미 올라간 같은 영상을 다시 올리다 끊긴 것이면 기록만 남기고 알림은 보내지 않는다(메시지 null = DB 함수가 알리지 않는다).
    const repeat = terminal && await alreadyUploadedSameVideo(db, { tenantId: link.tenant_id, studentId: link.student_id, bytes: Number(upload.bytes) });
    const result = await db.rpc("record_homework_video_upload_event", {
      p_tenant: link.tenant_id, p_link: link.id, p_upload: input.uploadId, p_event: event,
      p_failure_message: !terminal || repeat ? null : event.kind === "page_left" ? "제출 완료 전에 화면을 떠난 기록이 있습니다." : uploadFailureText(event.reason ?? "unknown").label,
    });
    if (result.error) {
      console.warn(JSON.stringify({ scope: "videoSubmit.diagnostics", code: result.error.code }));
      return 503;
    }
    return result.data === "limited" ? 429 : result.data === "invalid" ? 404 : 204;
  } catch { return 503; }
}
