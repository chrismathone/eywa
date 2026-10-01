export type HomeworkVideo = {
  id: string;
  subject: string | null;
  posted_at: string | null;
  created_at: string;
  comment_id: number | null;
  status: "queued" | "processing" | "uploaded" | "failed";
  drive_file_id: string | null;
  bytes: number | null;
  /** Drive에 올라간 시각 — 막 올라간 영상은 재생기가 접근 확인(썸네일)을 건너뛴다. */
  uploaded_at: string | null;
};

export function homeworkVideoLinks(fileId: string | null) {
  if (!fileId || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null;
  return {
    view: `https://drive.google.com/file/d/${fileId}/view`,
    preview: `https://drive.google.com/file/d/${fileId}/preview`,
    // 재생 전 접근 확인용(homework-video-player) — 권한이 있는 구글 계정에만 이미지가 온다.
    thumbnail: `https://drive.google.com/thumbnail?id=${fileId}&sz=w64`,
  };
}

export const HOMEWORK_VIDEO_STATUS = {
  queued: "업로드 대기", processing: "업로드 중", uploaded: "재생", failed: "재시도 대기",
} as const;
