import { addDays, kstDateOf } from "@/lib/date-kst";
import { homeworkDue } from "./due";
import { buildLedgerRounds, roundPairKey, VIDEO_MATCH_WINDOW_DAYS } from "./rounds";
import type { VideoArrival, VideoHomeworkMark } from "./types";

export type AssignedHomework = { classId: string; studentId: string; date: string; /** 반려 시각(장부와 같은 칸이 서게) */ rejectedAt?: string;
  /** 검사 기록 칸에서 옮겨 남긴 숙제(keep-round.ts) — 판정하지 않는다. 그 칸이 받은 영상만 미배정에서 뺀다. */ kept?: true;
  /** 보고서에 고른 마감('다음 수업', due.ts) — 없으면 숙제일 + 7일. */ due?: string };
export type AutoOutcome = { classId: string; studentId: string; homeworkDate: string; status: "submitted" | "missing" | "unchecked"; videoId: string | null };

/**
 * 실제 파일로만 최종 판정한다. 수동 체크는 학생의 업로드나 영상 배정 순서를 바꾸지 않는다.
 * 판정(저장 상태·알림)은 **정식 숙제 칸**만 — 옮겨 남긴 숙제(`kept`)와 검사 기록만 있는 칸(`marks`)은 장부가 ②의 뒷순위로 영상을 붙이는 자리라
 * 같은 칸을 짜서 그 칸이 받은 영상을 미배정에서만 뺀다(장부와 알림이 같은 말을 하게 — 적대적 리뷰 2026-10-13). 기록은 정식 칸의 영상 짝을 바꾸지 않는다.
 */
export function videoHomeworkOutcomes(assignments: AssignedHomework[], videos: VideoArrival[], today: string, fromDate: string,
  marks: readonly VideoHomeworkMark[] = []) {
  const rows = new Map<string, { classId: string; studentId: string; assignedDates: string[]; tracked: boolean; rejected: Record<string, string>; kept: string[]; dues: Record<string, string> }>();
  const rowOf = (pair: { classId: string; studentId: string }) => {
    const key = roundPairKey(pair);
    const row = rows.get(key) ?? { classId: pair.classId, studentId: pair.studentId, assignedDates: [], tracked: true, rejected: {}, kept: [], dues: {} };
    rows.set(key, row);
    return row;
  };
  for (const homework of assignments) {
    const row = rowOf(homework);
    row.assignedDates.push(homework.date);
    if (homework.kept) row.kept.push(homework.date);
    if (homework.rejectedAt) row.rejected[homework.date] = homework.rejectedAt;
    if (homework.due) row.dues[homework.date] = homework.due;
  }
  for (const mark of marks) if (mark.homeworkDate) rowOf(mark);
  const uploaded = videos.filter(video => {
    const day = kstDateOf(video.postedAt);
    return !!video.playback && !!day && day <= today;
  });
  const rounds = buildLedgerRounds({ rows: [...rows.values()], marks: marks.filter((mark) => !!mark.homeworkDate), videos: uploaded, fromDate, toDate: today });
  const outcomes: AutoOutcome[] = [];
  const used = new Set<string>();
  for (const row of rows.values()) for (const round of rounds.get(roundPairKey(row)) ?? []) {
    if (round.videoId) used.add(round.videoId);
    if (!round.homeworkDate || !round.assigned) continue;
    // 마감 당일 끝까지 받는다(due.ts — 기본 숙제일 + 7일: 10/1 숙제는 10/8까지, 10/9부터 미제출 · '다음 수업'이면 그 수업일까지).
    outcomes.push({
      classId: row.classId, studentId: row.studentId, homeworkDate: round.homeworkDate,
      status: round.videoId ? "submitted" : today > homeworkDue(round.homeworkDate, round.due) ? "missing" : "unchecked", videoId: round.videoId,
    });
  }
  // 이미 배정된 같은 파일의 사본은 미배정 알림에서도 뺀다.
  const assignedFiles = new Set(uploaded.filter(video => used.has(video.id) && video.fingerprint)
    .map(video => `${video.studentId}:${video.classId}:${video.fingerprint}`));
  const homeworkKeys = new Set(outcomes.map(outcome => `${outcome.studentId}:${outcome.classId}:${outcome.homeworkDate}`));
  const unmatched = uploaded.filter(video => {
    const day = kstDateOf(video.postedAt);
    // 같은 숙제를 명시한 추가 파일도 이미 연결된 영상이다(대표 영상 하나만 회차에 보인다).
    const postedDay = kstDateOf(video.postedAt)!;
    const explicit = video.classId && video.homeworkDate && homeworkKeys.has(`${video.studentId}:${video.classId}:${video.homeworkDate}`)
      && postedDay >= video.homeworkDate && postedDay <= addDays(video.homeworkDate, VIDEO_MATCH_WINDOW_DAYS);
    return !used.has(video.id) && !video.manuallyAssigned && !!day && day < today
      && !explicit
      && day >= addDays(today, -14)
      && !(video.fingerprint && assignedFiles.has(`${video.studentId}:${video.classId}:${video.fingerprint}`));
  });
  return { outcomes, unmatched };
}
