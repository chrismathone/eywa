export type HomeworkVideo = {
  id: string;
  subject: string | null;
  posted_at: string | null;
  created_at: string;
  comment_id: number | null;
  status: "queued" | "processing" | "uploaded" | "failed" | "review";
  drive_file_id: string | null;
  bytes: number | null;
  /** 영상 출처(0324a). 칸이 없던 때 읽은 행은 비어 있다 = ClassNote 수집분. */
  source?: HomeworkVideoSource | null;
  /** Drive에 올라간 시각 — 막 올라간 영상은 재생기가 접근 확인(썸네일)을 건너뛴다. */
  uploaded_at: string | null;
};

/** 0324a `student_homework_videos.source` — 화면엔 아래 라벨로만 보인다(원시값 노출 금지). */
export type HomeworkVideoSource = "classnote" | "drive" | "link";

/** 직접 들어온 영상의 출처 라벨. ClassNote 수집분은 글·댓글로 나뉘므로 `homeworkVideoOrigin`을 쓴다. */
export const HOMEWORK_VIDEO_SOURCE_LABEL = {
  drive: "직접 제출", // 선생님·관리자가 담임 폴더에 올린 영상(원장 2026-10-01)
  link: "제출 링크", // aywa 제출 링크로 학부모가 올린 영상
} as const;

/** 목록 한 줄의 출처 — ClassNote 학부모 글·댓글 · 직접 제출 · 제출 링크. 모르는 값도 원시값을 내보내지 않는다. */
export function homeworkVideoOrigin(row: Pick<HomeworkVideo, "source" | "comment_id">): string {
  if (row.source === "drive" || row.source === "link") return HOMEWORK_VIDEO_SOURCE_LABEL[row.source];
  return row.comment_id ? "학부모 댓글" : "학부모 글";
}

/**
 * 같은 학생 목록에 같은 영상(MD5·크기)이 두 줄 서지 않게 — ClassNote 수집분(반 못 정함)과 같은 내용을 반까지 적어 직접 올린 사본은
 * 둘 다 '재생'이라(장부는 반이 정해진 쪽만 세 이중 집계는 없다) 탭에서만 하나로 접는다. 과목이 정해진 쪽 → 재생 가능한 쪽 → 앞선 쪽.
 * 지문(md5)은 접는 데만 쓰고 화면으로 내보내지 않는다.
 */
export function dedupeHomeworkVideos(rows: readonly (HomeworkVideo & { md5?: string | null })[]): HomeworkVideo[] {
  const key = (row: { md5?: string | null; bytes: number | null }) => (row.md5 && row.bytes != null ? `${row.md5}:${row.bytes}` : null);
  const score = (row: HomeworkVideo) => (row.subject ? 2 : 0) + (row.status === "uploaded" ? 1 : 0);
  const best = new Map<string, HomeworkVideo>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const current = best.get(k);
    if (!current || score(row) > score(current)) best.set(k, row);
  }
  return rows.filter((row) => { const k = key(row); return !k || best.get(k) === row; }).map((row) => {
    const copy = { ...row };
    delete copy.md5;
    return copy;
  });
}

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
  queued: "업로드 대기", processing: "업로드 중", uploaded: "재생", failed: "재시도 대기", review: "확인 필요",
} as const;
