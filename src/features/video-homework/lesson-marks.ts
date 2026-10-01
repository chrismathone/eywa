/**
 * 원스크린 '지난 수업 영상 숙제' 칸에 세울 기록 고르기 — (반 × 학생)마다 하나(순수 · 서버/테스트 공용).
 *
 * 같은 숙제 = 한 칸(원장 2026-10-01). 영상 제출 현황에서 먼저 찍은 기록은 검사일이 오늘이 아니므로, 그날 찍은 기록뿐 아니라
 * **그 행의 지난 수업일(숙제일)이 같은 기록**도 그 칸의 기록이다. 그래야 강사가 이미 확인된 숙제를 미확인으로 보고 다시 찍지 않는다.
 *  · 숙제일이 같은 기록이 먼저, 그다음이 오늘 자리의 기록(예전 동작 — 숙제일이 달라도 오늘 찍은 기록은 남긴다:
 *    뒤늦게 끼운 보고서로 지난 수업일이 바뀌어도 강사가 방금 찍은 체크가 사라져 보이지 않게).
 */
import type { VideoHomeworkMark } from "./types";

export type LessonMarkTarget = { classId: string; studentId: string; homeworkDate?: string | null };
const pairKey = (row: { classId: string; studentId: string }) => `${row.classId}:${row.studentId}`;

export function pickLessonMarks(marks: VideoHomeworkMark[], targets: LessonMarkTarget[], checkDate: string): VideoHomeworkMark[] {
  const wanted = new Map<string, string | null>();
  for (const target of targets) {
    const key = pairKey(target);
    if (!wanted.get(key)) wanted.set(key, target.homeworkDate ?? null);
  }
  const rank = (mark: VideoHomeworkMark, homeworkDate: string | null | undefined) => {
    const sameHomework = !!homeworkDate && mark.homeworkDate === homeworkDate;
    const today = mark.checkDate === checkDate;
    if (sameHomework) return today ? 4 : 3;
    if (!today) return 0;
    // 오늘 자리의 기록 — 숙제일을 모르는 쪽이 있으면 같은 숙제로 보고, 서로 다르면 가장 낮게(그래도 남긴다).
    return !homeworkDate || !mark.homeworkDate ? 2 : 1;
  };
  const picked = new Map<string, VideoHomeworkMark>();
  for (const mark of marks) {
    const key = pairKey(mark);
    const score = rank(mark, wanted.get(key));
    if (!score) continue;
    const current = picked.get(key);
    if (!current || score > rank(current, wanted.get(key))) picked.set(key, mark);
  }
  return [...picked.values()];
}
