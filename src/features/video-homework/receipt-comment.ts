import { addDays, kstDateOf } from "@/lib/date-kst";
import { buildLedgerRounds } from "./rounds";
import type { VideoArrival } from "./types";

/** 실제 파일만 사용한다. 수동 ✓는 학부모에게 보낼 제출 근거가 아니다. */
export function videoReceiptComment(input: {
  classId: string; studentId: string; homeworkDates: string[]; videos: VideoArrival[];
  reportDate: string; previousReportDate: string | null; fromDate: string;
  historyComplete?: boolean;
}): string | null {
  const dates = [...new Set(input.homeworkDates)].filter(date => date < input.reportDate).sort();
  const videos = input.videos.filter(video => !!video.playback && kstDateOf(video.postedAt)! <= input.reportDate);
  const rounds = buildLedgerRounds({ rows: [{ classId: input.classId, studentId: input.studentId, assignedDates: dates, tracked: true }],
    videos, marks: [], fromDate: input.fromDate, toDate: input.reportDate }).get(`${input.classId}:${input.studentId}`) ?? [];
  // 지난 보고서 이후 새로 받은 영상만 말한다. 같은 숙제를 다음 수업마다 다시 칭찬하지 않는다.
  const since = input.previousReportDate ?? addDays(input.reportDate, -7);
  const recent = rounds.filter(round => round.videoDate && round.videoDate > since && round.videoDate <= input.reportDate);
  if (!recent.length) return null;
  // '모두'는 여러 건을 한꺼번에 마무리했고, 조회 범위에 남은 숙제가 없을 때만 쓴다.
  // 한두 건을 냈거나, 과거 한 건이라도 남아 있으면 평범한 제출 문장으로 충분하다.
  if (input.historyComplete !== false && recent.length >= 3 && rounds.length >= 3 && rounds.every(round => !!round.videoId)) return "지난 영상 숙제를 모두 제출했습니다.";
  return "지난 영상 숙제도 제출했습니다.";
}

export function appendVideoReceiptComment(comment: string, receipt: string | null): string {
  if (!receipt || !comment.trim()) return comment;
  // 동일한 확인 문장이 기존 초안에 들어 있어도 한 번만 둔다.
  const body = comment.replace(/지난 영상 숙제(?:를 모두|도) 제출했습니다\.[ \t]*/g, "").trim();
  return `${body} ${receipt}`;
}
