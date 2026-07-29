// 클라 전용 업로드 헬퍼 — 서버 발급 UploadTicket으로 Supabase signed upload. ⚠️ media-storage(server-only)
// import 금지, 타입만 types.ts에서 [[#61]]. (2026-07-29 GCS XHR PUT 분기 제거 — 진행률은 0→100 2단계.)
import type { UploadTicket } from "./types";

export async function uploadToTicket(
  ticket: UploadTicket,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const { createClient } = await import("@/lib/supabase/client");
  const { error } = await createClient()
    .storage.from(ticket.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
  if (error) throw new Error(`업로드 실패: ${error.message}`);
  onProgress?.(100);
}
