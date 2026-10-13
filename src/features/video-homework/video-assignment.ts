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
  /** 학생이 숙제 없이 올리며 남긴 메모(올리기 사이트, 2026-10-13) — 무슨 영상인지. 없으면 null. */
  note: string | null;
  postId: number | null; revision: number; excluded: boolean;
  playback: { preview: string; thumbnail: string; uploadedAt: string | null } | null;
};
export type VideoAssignmentOptions = { ok: true; videos: AssignableVideo[]; dates: string[] } | { ok: false; error: string };
