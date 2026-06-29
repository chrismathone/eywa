import type { StorageBackend } from "./types";

// 신규 미디어 업로드/읽기 백엔드 선택 — 순수(server-only 없음 → Vitest 가능).
// 기본 gcs(ijw Firebase). 결제 구간 오면 env MEDIA_STORAGE_BACKEND=supabase로 스왑(전역 플래그).
export function getMediaBackend(): StorageBackend {
  return process.env.MEDIA_STORAGE_BACKEND === "supabase" ? "supabase" : "gcs";
}
