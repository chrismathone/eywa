import { addDays, kstDateOf } from "@/lib/date-kst";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { buildLedgerRounds, roundPairKey, VIDEO_MATCH_WINDOW_DAYS } from "./rounds";
import type { VideoArrival } from "./types";

export type AssignedHomework = { classId: string; studentId: string; date: string };
export type AutoOutcome = { classId: string; studentId: string; homeworkDate: string; status: "submitted" | "missing" | "unchecked"; videoId: string | null };

/** 실제 파일로만 최종 판정한다. 수동 체크는 학생의 업로드나 영상 배정 순서를 바꾸지 않는다. */
export function videoHomeworkOutcomes(assignments: AssignedHomework[], videos: VideoArrival[], today: string, fromDate: string) {
  const rows = new Map<string, { classId: string; studentId: string; assignedDates: string[]; tracked: boolean }>();
  for (const homework of assignments) {
    const key = roundPairKey(homework);
    const row = rows.get(key) ?? { ...homework, assignedDates: [], tracked: true };
    row.assignedDates.push(homework.date);
    rows.set(key, row);
  }
  const uploaded = videos.filter(video => {
    const day = kstDateOf(video.postedAt);
    return !!video.playback && !!day && day <= today;
  });
  const rounds = buildLedgerRounds({ rows: [...rows.values()], marks: [], videos: uploaded, fromDate, toDate: today });
  const outcomes: AutoOutcome[] = [];
  const used = new Set<string>();
  for (const row of rows.values()) for (const round of rounds.get(roundPairKey(row)) ?? []) {
    if (!round.homeworkDate) continue;
    if (round.videoId) used.add(round.videoId);
    // 숙제일 + 7일 당일 끝까지 받는다. 예: 10/1 숙제는 10/8까지, 10/9부터 미제출.
    outcomes.push({
      classId: row.classId, studentId: row.studentId, homeworkDate: round.homeworkDate,
      status: round.videoId ? "submitted" : today > addDays(round.homeworkDate, SITE_HOMEWORK_DAYS) ? "missing" : "unchecked", videoId: round.videoId,
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
