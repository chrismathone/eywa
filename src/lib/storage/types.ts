// 스토리지 추상화 공용 타입 — ⚠️ server-only **없음**. 클라 헬퍼(upload-to-ticket.ts)가 `UploadTicket`을
// import해야 하므로 서비스계정/서버 의존을 절대 끌어오지 말 것 [[#61]].

export type StorageBackend = "gcs" | "supabase";

/** 미디어 종류 — 오디오 3종 + 이미지 2종 + 서식 문서 1종. 각자 버킷/검증/크기·형식 제한이 다름(media-storage MEDIA_KIND). */
export type MediaKind = "meeting" | "consultation" | "registration" | "receipt" | "branding" | "document";

/**
 * 업로드 티켓 — 서버가 발급, 클라가 `uploadToTicket`으로 소비.
 * - gcs: `uploadUrl`(v4 signed PUT) + `headers`("Content-Type" 일치 필수, 불일치=403). 클라가 그대로 PUT.
 * - supabase: `bucket`+`token`으로 `uploadToSignedUrl`.
 * 어느 백엔드든 `path`는 **서버가 빌드**(클라 입력 불신).
 */
export type UploadTicket = {
  backend: StorageBackend;
  uploadUrl: string;
  path: string;
  bucket?: string;
  token?: string;
  headers?: Record<string, string>;
};
