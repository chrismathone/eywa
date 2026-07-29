// 스토리지 추상화 공용 타입 — ⚠️ server-only **없음**. 클라 헬퍼(upload-to-ticket.ts)가 `UploadTicket`을
// import해야 하므로 서비스계정/서버 의존을 절대 끌어오지 말 것 [[#61]].

/** 미디어 종류 — 오디오 3종 + 이미지 2종 + 서식 문서 1종 + 보고서 첨부(사진). 각자 버킷/검증/크기·형식 제한이 다름(media-storage MEDIA_KIND). */
export type MediaKind =
  | "meeting"
  | "consultation"
  | "registration"
  | "receipt"
  | "branding"
  | "document"
  | "report_attachment";

/**
 * 업로드 티켓 — 서버가 발급, 클라가 `uploadToTicket`으로 소비(`bucket`+`token`으로 uploadToSignedUrl).
 * `path`는 **서버가 빌드**한다(클라 입력 불신). 2026-07-29 GCS 분기 제거로 backend/headers 필드는 사라졌다.
 */
export type UploadTicket = {
  uploadUrl: string;
  path: string;
  bucket: string;
  token: string;
};
