import { homeworkVideoLinks } from "@/features/students/homework-videos";
import type { ThreadVideo } from "./reply-types";

/**
 * 쓰레드에 붙는 영상 한 줄의 화면 모델(순수 — 서버·테스트 공용). `student_homework_videos`의 상태 → 한글 문구 + 재생 여부.
 * 🔴 `links`(Drive 파일 주소)는 **열람 게이트를 통과한 호출부만** 만든다 — 이 함수는 `canView`가 false면 주소를 절대 싣지 않는다(#77).
 */
export type VideoRow = { id: string; status: string; drive_file_id: string | null; uploaded_at: string | null };

export const VIDEO_PENDING_TEXT = "영상을 보관하는 중입니다. 잠시 후 재생할 수 있습니다.";

export function toThreadVideo(row: VideoRow, opts: { canView: boolean }): ThreadVideo {
  const base = { id: row.id, uploadedAt: row.uploaded_at, links: null as ThreadVideo["links"] };
  if (!opts.canView) return { ...base, playable: false, pending: false, label: "영상을 볼 권한이 없습니다" };
  if (row.status === "uploaded") {
    const l = homeworkVideoLinks(row.drive_file_id);
    if (l) return { ...base, playable: true, pending: false, label: "영상 보기", links: { preview: l.preview, thumbnail: l.thumbnail } };
    return { ...base, playable: false, pending: true, label: "영상 주소를 확인하는 중입니다. 잠시 후 다시 확인합니다." };
  }
  if (row.status === "queued" || row.status === "processing") return { ...base, playable: false, pending: true, label: VIDEO_PENDING_TEXT };
  if (row.status === "failed") return { ...base, playable: false, pending: true, label: "영상 보관에 실패해 다시 시도하는 중입니다. 계속 안 되면 관리자에게 알려 주세요." };
  return { ...base, playable: false, pending: false, label: "확인이 필요한 영상입니다. 관리자가 확인한 뒤 볼 수 있습니다." };
}

/**
 * 이 영상 행이 그 쓰레드 학생의 것인가 — 학생이 적혀 있으면 같은 학생만, 비어 있으면(워커가 아직 학생을 못 적음) 원아를 아는 글일 때만.
 * 답글 창 영상(`loadPostVideos`)과 '학부모 글·답글' 면 개수(`countThreadMedia`)가 같이 쓴다(두 숫자가 갈라지지 않게).
 */
export function videoBelongsToThread(rowStudentId: string | null, a: { studentId: string | null; allowUnmatched: boolean }): boolean {
  return rowStudentId ? rowStudentId === a.studentId : a.allowUnmatched;
}

/** 이 글·댓글에 영상이 있다고 알려 주는 원문 표시(`[영상] (내용 없이 첨부만)` 등)인가 — 보관 행이 아직 없을 때의 안내용. */
export function hasVideoMarker(content: string): boolean {
  return /^\[[^\]]*영상[^\]]*\]/.test(content.trim());
}

/** 원문 표시의 사진 장수(`[사진 2장·영상] …`) — 없으면 0. */
export function markerPhotoCount(content: string): number {
  const m = /^\[[^\]]*사진\s*(\d+)\s*장[^\]]*\]/.exec(content.trim());
  return m ? Number(m[1]) : 0;
}

/** 영상이 안 보이는 이유(보관 행이 하나도 없을 때만) — 표시는 있는데 행이 없다. */
export const VIDEO_NOT_LISTED_TEXT = "영상이 아직 보관 목록에 없습니다. 수집이 끝나면 여기서 바로 볼 수 있습니다.";
/** 사진이 안 보이는 이유(주소를 아직 못 받았다 — 이 기능 전에 온 글·표 적용 전) */
export const PHOTO_NOT_LISTED_TEXT = "사진을 아직 불러오지 못했습니다. ClassNote에서는 볼 수 있습니다.";
/** 학생이 아직 연결되지 않은 글 — 관리자도 영상·사진 열람 판정을 할 수 없다 */
export const NO_STUDENT_TEXT = "이 글의 학생이 아직 연결되지 않아 영상·사진을 열 수 없습니다.";
/** 학생 '숙제 영상' 탭과 같은 문(students 메뉴 + 그 학생 열람)을 못 넘었다 */
export const MEDIA_LOCKED_TEXT = "이 학생의 영상·사진을 볼 권한이 없습니다.";
/** 답글 자격이 없어 최소 쓰레드로 열었다 — 영상·사진은 답글을 쓸 수 있는 글에서만 싣는다(이유는 창 아래 한 줄에 따로 나온다) */
export const MEDIA_REPLY_ONLY_TEXT = "영상·사진은 이 글에 답글을 쓸 수 있을 때만 여기서 볼 수 있습니다.";
