import { addDays, kstDateOf } from "@/lib/date-kst";
import { buildLedgerRounds } from "./rounds";
import type { VideoArrival } from "./types";

/** 실제 파일만 사용한다. 수동 ✓는 학부모에게 보낼 제출 근거가 아니다. */
export function videoReceiptComment(input: {
  classId: string; studentId: string; homeworkDates: string[]; videos: VideoArrival[];
  reportDate: string; previousReportDate: string | null; previousReportAt?: string | null; fromDate: string;
  historyComplete?: boolean;
  /** 반려한 숙제(숙제일 → 반려 시각) — 장부와 같은 칸이 서게(rounds.ts). */
  rejected?: Readonly<Record<string, string>>;
  /** 검사 기록 칸에서 옮겨 남긴 숙제(keep-round.ts) — 장부와 같은 칸이 서게 넣되(그 칸을 고른 영상이 거기 붙는다) 댓글로는 세지 않는다. */
  keptDates?: string[];
}): string | null {
  const official = [...new Set(input.homeworkDates)].filter(date => date < input.reportDate);
  const kept = [...new Set(input.keptDates ?? [])].filter(date => date < input.reportDate && !official.includes(date));
  const dates = [...official, ...kept].sort();
  const receivedAt = (video: VideoArrival) => Math.max(Date.parse(video.postedAt),
    Date.parse(video.playback?.uploadedAt ?? video.postedAt) || Date.parse(video.postedAt));
  const end = Date.parse(`${addDays(input.reportDate, 1)}T00:00:00+09:00`);
  const videos = input.videos.filter(video => !!video.playback && !!kstDateOf(video.postedAt) && receivedAt(video) < end);
  const rounds = (buildLedgerRounds({ rows: [{ classId: input.classId, studentId: input.studentId, assignedDates: dates, tracked: true, rejected: input.rejected, kept }],
    videos, marks: [], fromDate: input.fromDate, toDate: input.reportDate }).get(`${input.classId}:${input.studentId}`) ?? []).filter(round => round.assigned);
  // 지난 보고서 이후 새로 받은 영상만 말한다. 같은 숙제를 다음 수업마다 다시 칭찬하지 않는다.
  const sinceDate = input.previousReportDate ?? addDays(input.reportDate, -7);
  // 발송한 날 밤에 낸 영상도 다음 보고서에 싣는다. 발송 시각을 모르는 옛 기록만 날짜 경계를 쓴다.
  const since = input.previousReportAt && kstDateOf(input.previousReportAt) === input.previousReportDate
    ? Date.parse(input.previousReportAt) : Date.parse(`${addDays(sinceDate, 1)}T00:00:00+09:00`) - 1;
  const byId = new Map(videos.map(video => [video.id, video]));
  const recent = rounds.filter(round => round.videoId && receivedAt(byId.get(round.videoId)!) > since);
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
