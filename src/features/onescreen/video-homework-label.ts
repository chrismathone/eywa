import { siteHomeworkLastDay } from "@/features/video-submit/site";
import { isVideoHomeworkDate } from "@/features/video-homework/types";

/** 실제 제출 창과 같은 '수업일 + 7일'. 발송일·오늘 날짜로 연장하지 않는다. */
export function videoHomeworkDueLabel(reportDate: string | null, assigned?: boolean | null): string | null {
  if (assigned !== true || !reportDate || !isVideoHomeworkDate(reportDate)) return null;
  const day = siteHomeworkLastDay(reportDate);
  return `~${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} (${"일월화수목금토"[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
}
