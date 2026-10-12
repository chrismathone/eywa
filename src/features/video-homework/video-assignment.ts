import { addDays, kstDateOf } from "@/lib/date-kst";
import { isVideoHomeworkDate } from "./types";

/** 수동 배정: 숙제일과 게시일이 30일 이상 떨어진 영상은 후보에서 제외한다(KST 날짜 기준). */
export const VIDEO_ASSIGNMENT_MAX_DAY_GAP = 29;

export function videoAssignmentRange(dates: readonly string[]) {
  const sorted = dates.filter(isVideoHomeworkDate).sort();
  if (!sorted.length) return null;
  return { from: addDays(sorted[0], -VIDEO_ASSIGNMENT_MAX_DAY_GAP), to: addDays(sorted[sorted.length - 1], VIDEO_ASSIGNMENT_MAX_DAY_GAP) };
}

export function isVideoAssignableToDate(postedAt: string, homeworkDate: string): boolean {
  const postedDate = kstDateOf(postedAt);
  const range = videoAssignmentRange([homeworkDate]);
  return !!postedDate && !!range && postedDate >= range.from && postedDate <= range.to;
}

export type AssignableVideo = {
  id: string; postedAt: string; className: string | null; homeworkDate: string | null; source: string;
  postId: number | null; revision: number; excluded: boolean;
  playback: { preview: string; thumbnail: string; uploadedAt: string | null } | null;
};
export type VideoAssignmentOptions = { ok: true; videos: AssignableVideo[]; dates: string[] } | { ok: false; error: string };
