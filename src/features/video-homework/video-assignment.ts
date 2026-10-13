import { addDays, kstDateOf } from "@/lib/date-kst";
import { isVideoHomeworkDate } from "./types";

/** 수동 배정: 숙제를 낸 당일부터 14일 뒤까지 게시된 영상만 허용한다(KST 날짜 기준). */
export const VIDEO_ASSIGNMENT_WINDOW_DAYS = 14;

export function videoAssignmentRange(dates: readonly string[]) {
  const sorted = dates.filter(isVideoHomeworkDate).sort();
  if (!sorted.length) return null;
  return { from: sorted[0], to: addDays(sorted[sorted.length - 1], VIDEO_ASSIGNMENT_WINDOW_DAYS) };
}

export function isVideoAssignableToDate(postedAt: string, homeworkDate: string): boolean {
  const postedDate = kstDateOf(postedAt);
  const range = videoAssignmentRange([homeworkDate]);
  return !!postedDate && !!range && postedDate >= range.from && postedDate <= range.to;
}

export type AssignableVideo = {
  id: string; postedAt: string; className: string | null; homeworkDate: string | null; source: string;
  /** 영상이 분류된 반(없으면 null) — 배정 창이 "다른 반 영상"을 가른다. */
  classId?: string | null;
  /** 학생이 숙제 없이 올리며 남긴 메모(올리기 사이트, 2026-10-13) — 무슨 영상인지. 없으면 null. */
  note: string | null;
  postId: number | null; revision: number; excluded: boolean;
  playback: { preview: string; thumbnail: string; uploadedAt: string | null } | null;
};
export type VideoAssignmentOptions = { ok: true; videos: AssignableVideo[]; dates: string[] } | { ok: false; error: string };

/**
 * 확실히 **다른 과목** 영상인가(원장 2026-10-13 *"확실한 타과목 영상은 리스트에 팝업되지 않게"*) — 영상의 반이 정해져 있으면 그 반의 과목,
 * 반이 없으면 영상에 적힌 과목(ClassNote 보드에서 온 값)이 이 반 과목과 다를 때만 참. 과목을 모르면 거짓(보여 준다 — 반을 못 정한 영상을
 * 선생님이 보고 고를 수 있게). 배정 창 목록 · '영상 배정' 버튼 · 배정 저장이 같은 판정을 쓴다.
 */
export function isOtherSubjectVideo(video: { classSubject: string | null | undefined; subject: string | null | undefined }, targetSubject: string | null | undefined): boolean {
  // 반의 과목과 영상에 적힌 과목이 서로 다르면 확실하지 않다(분류가 틀렸을 수 있다) — 보여 준다(적대적 리뷰 2026-10-13).
  if (video.classSubject && video.subject && video.classSubject !== video.subject) return false;
  const known = video.classSubject || video.subject || null;
  return !!known && !!targetSubject && known !== targetSubject;
}
