export type HomeworkVideo = {
  id: string;
  subject: string | null;
  posted_at: string | null;
  created_at: string;
  comment_id: number | null;
  status: "queued" | "processing" | "uploaded" | "failed";
  drive_file_id: string | null;
  bytes: number | null;
};

export function homeworkVideoLinks(fileId: string | null) {
  if (!fileId || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null;
  return { view: `https://drive.google.com/file/d/${fileId}/view`, preview: `https://drive.google.com/file/d/${fileId}/preview` };
}

export const HOMEWORK_VIDEO_STATUS = {
  queued: "업로드 대기", processing: "업로드 중", uploaded: "재생", failed: "재시도 대기",
} as const;
