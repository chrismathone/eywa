import { addDays, kstDateOf } from "@/lib/date-kst";
import { homeworkDue } from "./due";
import { buildLedgerRounds, roundPairKey, VIDEO_MATCH_WINDOW_DAYS, type LedgerRound } from "./rounds";
import type { VideoArrival, VideoHomeworkMark } from "./types";
import { isOtherSubjectVideo, isVideoAssignableToDate } from "./video-assignment";

/** 반 → 과목(모르면 null) — 빈 숙제를 같은 과목 반에서만 찾는다(`fillableCells`). */
export type ClassSubjectOf = (classId: string) => string | null | undefined;

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
  marks: readonly VideoHomeworkMark[] = [], subjectOf?: ClassSubjectOf) {
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
  for (const row of rows.values()) for (const round of rounds.get(roundPairKey(row)) ?? []) {
    if (!round.homeworkDate || !round.assigned) continue;
    // 마감 당일 끝까지 받는다(due.ts — 기본 숙제일 + 7일: 10/1 숙제는 10/8까지, 10/9부터 미제출 · '다음 수업'이면 그 수업일까지).
    outcomes.push({
      classId: row.classId, studentId: row.studentId, homeworkDate: round.homeworkDate,
      status: round.videoId ? "submitted" : today > homeworkDue(round.homeworkDate, round.due) ? "missing" : "unchecked", videoId: round.videoId,
    });
  }
  // 알림은 어제까지 올린 · 14일 안의 영상만(당일 영상은 아직 분류·배정 중일 수 있다).
  const unmatched = unmatchedVideos(uploaded, rounds).filter(video => {
    const day = kstDateOf(video.postedAt)!;
    return day < today && day >= addDays(today, -14);
  });
  // 알림·할 일은 그중 붙일 빈 숙제가 있는 영상만(`fillableCells`). 나머지(`unmatched` − `fillable`)는 열린 할 일을 '취소'로 닫는 데 쓴다.
  const cells = fillableCells(unmatched, rounds, subjectOf);
  return { outcomes, unmatched, fillable: unmatched.filter(video => cells.has(video.id)) };
}

/**
 * 미배정 영상마다 **붙일 빈 숙제 칸**(반:학생 목록) — 빈 칸이 없는 영상은 지도에 없다. 원장 2026-10-23 *"숙제가 없는데도 미배정 영상이
 * 남아있으면 그건 알림 오류"*(이영준 10/15: 숙제 넷이 영상으로 다 찼는데 '숙제 없이 올린' 둘째 영상 때문에 할 일이 섰다). 미배정 알림 · '미배정 영상'
 * 할 일이 이 판정을 쓴다. 장부의 '영상 배정' 버튼·'영상 배정 필요함'(붙일 수 있는가)은 종전 판정 그대로 — 숙제가 다 찬 줄의 숙제 없이 올린 영상 ·
 * 숙제 0건 반의 영상도 붙일 수는 있다(2026-10-22 결정).
 * 빈 칸 = 같은 학생의 숙제 칸 중 영상이 안 붙었고 손으로 찍은 완료도 아닌 칸(미확인·미수행 — 옮겨 남긴 숙제·검사 기록 칸 포함),
 * 그 영상을 올린 날이 숙제일부터 14일 안(배정 창과 같은 `isVideoAssignableToDate`). 확실히 다른 과목 반의 칸은 빼고(배정 창 목록 · '영상 배정'
 * 버튼과 같은 `isOtherSubjectVideo` — 반의 과목, 반을 모르면 영상에 적힌 과목), 과목을 모르면 따지지 않는다.
 */
export function fillableCells(videos: readonly VideoArrival[], rounds: ReadonlyMap<string, readonly LedgerRound[]>,
  subjectOf: ClassSubjectOf = () => null): Map<string, string[]> {
  const open = new Map<string, { pair: string; classId: string; dates: string[] }[]>();
  for (const [pair, list] of rounds) {
    const dates = list.flatMap(round => round.homeworkDate && !round.videoId && round.status !== "submitted" ? [round.homeworkDate] : []);
    if (!dates.length) continue;
    const [classId, studentId] = pair.split(":");
    open.set(studentId, [...(open.get(studentId) ?? []), { pair, classId, dates }]);
  }
  const cells = new Map<string, string[]>();
  for (const video of videos) {
    const own = { classSubject: video.classId ? subjectOf(video.classId) : null, subject: video.subject };
    const pairs = (open.get(video.studentId) ?? []).filter(cell => !isOtherSubjectVideo(own, subjectOf(cell.classId))
      && cell.dates.some(date => isVideoAssignableToDate(video.postedAt, date))).map(cell => cell.pair);
    if (pairs.length) cells.set(video.id, pairs);
  }
  return cells;
}

/**
 * **칸에 붙지 않은 영상**(미배정) — 미배정 알림(위)과 영상 제출 현황의 숙제 0건 반 줄(`ledger-queries.ts` ①)이 같은 판정을 쓴다.
 * `rounds` = 같은 재료로 짠 회차(`buildLedgerRounds` — 반 × 학생 → 칸). 칸이 세는 영상(대표 · 같은 숙제에 더 낸 영상 — 옮겨 남긴 숙제 칸 포함),
 * 정식 숙제를 골라 올린 영상, 손 배정한 영상, 이미 붙은 파일의 사본은 미배정이 아니다. 언제 올린 영상을 볼지는 호출부가 거른다.
 */
export function unmatchedVideos(videos: readonly VideoArrival[], rounds: ReadonlyMap<string, readonly LedgerRound[]>): VideoArrival[] {
  const used = new Set<string>();
  const homeworkKeys = new Set<string>();
  for (const [pair, list] of rounds) for (const round of list) {
    if (round.videoId) used.add(round.videoId);
    // 같은 숙제에 더 낸 영상도 그 칸의 영상이다(한 숙제에 여러 개 — 원장 2026-10-21).
    for (const id of round.videoIds) used.add(id);
    if (round.homeworkDate && round.assigned) homeworkKeys.add(`${pair}:${round.homeworkDate}`);
  }
  // 이미 배정된 같은 파일의 사본은 미배정에서도 뺀다.
  const assignedFiles = new Set(videos.filter(video => used.has(video.id) && video.fingerprint)
    .map(video => `${video.studentId}:${video.classId}:${video.fingerprint}`));
  return videos.filter(video => {
    const day = kstDateOf(video.postedAt);
    if (!video.playback || !day || used.has(video.id) || video.manuallyAssigned) return false;
    // 같은 숙제를 명시한 추가 파일도 이미 연결된 영상이다(대표 영상 하나만 회차에 보인다).
    const explicit = video.classId && video.homeworkDate && homeworkKeys.has(`${roundPairKey({ classId: video.classId, studentId: video.studentId })}:${video.homeworkDate}`)
      && day >= video.homeworkDate && day <= addDays(video.homeworkDate, VIDEO_MATCH_WINDOW_DAYS);
    return !explicit && !(video.fingerprint && assignedFiles.has(`${video.studentId}:${video.classId}:${video.fingerprint}`));
  });
}
