// 클라 전용 업로드 헬퍼 — 서버 발급 UploadTicket으로 파일 PUT. ⚠️ media-storage(server-only) import 금지,
// 타입만 types.ts에서 [[#61]]. gcs=XHR PUT(진행률 보존, headers 그대로) / supabase=uploadToSignedUrl.
import type { UploadTicket } from "./types";

export async function uploadToTicket(
  ticket: UploadTicket,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (ticket.backend === "gcs") {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", ticket.uploadUrl);
      // ⚠️ sign 시 contentType과 동일 헤더로 PUT해야 GCS 서명 통과(불일치=403).
      for (const [k, v] of Object.entries(ticket.headers ?? {})) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`업로드 실패 (${xhr.status})`));
      xhr.onerror = () => reject(new Error("업로드 네트워크 오류 (스토리지 CORS 설정 확인 필요)"));
      xhr.send(file);
    });
    return;
  }
  // supabase 백엔드 — token 기반 signed upload.
  const { createClient } = await import("@/lib/supabase/client");
  const { error } = await createClient()
    .storage.from(ticket.bucket!)
    .uploadToSignedUrl(ticket.path, ticket.token!, file, { contentType: file.type || undefined });
  if (error) throw new Error(`업로드 실패: ${error.message}`);
  onProgress?.(100);
}
