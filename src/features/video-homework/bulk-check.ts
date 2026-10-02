/**
 * 원스크린 **일괄 입력의 '지난 영상 숙제 검사'** 대상 계산(순수) — 원장 2026-10-02 *"일괄 입력에 지금 없는거 추가"*.
 *
 * 🔑 화면에 **검사 칸(✓/✕)이 보이는 행만** 대상이다 — 조건은 `VideoHomeworkCheck`(video-homework-provider.tsx)와 한 벌:
 *    반이 있고 · 학원 설정이 켠 반이고 · 지난 수업이 '영상 과제 없음'이 아닌(이미 찍은 기록이 있으면 남긴다) 행.
 *    칸이 안 보이는 행에 일괄로 기록을 만들면 강사가 되돌릴 자리가 없다(#103의 뒤집힌 꼴).
 * 팝오버의 미리보기 숫자와 실제 저장이 **같은 함수**를 쓴다(화면 숫자와 기록이 어긋나지 않게).
 */
import { hidesNextCheck, type VideoHomeworkAssignments } from "./assignment";
import { isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "./policy";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "./types";

export type BulkCheckRow = {
  classId: string | null | undefined;
  studentId: string;
  subjectKey: string | undefined;
  grade: string | null | undefined;
  /** 지난 수업일(그 행의 직전 보고서 날짜) — 모르면 null(옛 기록과 같은 자리에 적힌다). */
  homeworkDate: string | null | undefined;
};
export type BulkCheckContext = {
  policy: VideoHomeworkPolicy;
  assignments: VideoHomeworkAssignments;
  marks: readonly (Pick<VideoHomeworkMark, "classId" | "studentId" | "status"> & { homeworkDate?: string | null })[];
};
export type BulkCheckTarget = { classId: string; studentId: string; homeworkDate: string | null };

/** 검사 칸이 보이는 행인가 — 일괄 대상·미리보기 행 수가 함께 쓴다. */
export function hasVideoCheckCell(row: BulkCheckRow, ctx: BulkCheckContext): row is BulkCheckRow & { classId: string } {
  if (!row.classId) return false;
  if (!isVideoHomeworkEnabled(ctx.policy, { classId: row.classId, subjectKey: row.subjectKey ?? "math", grade: row.grade })) return false;
  const marked = ctx.marks.some((mark) => mark.classId === row.classId && mark.studentId === row.studentId);
  return marked || !hidesNextCheck(ctx.assignments, row.studentId, row.homeworkDate, row.classId);
}

/** 그 계획이 **이미 찍힌 기록을 바꾸는** 칸 수 — 팝오버가 적용 전에 밝히고 확인을 받는다(출결 일괄과 같은 규칙). */
export function countCheckOverwrites(targets: readonly BulkCheckTarget[], ctx: Pick<BulkCheckContext, "marks">): number {
  return targets.filter((t) => ctx.marks.some((m) => m.classId === t.classId && m.studentId === t.studentId)).length;
}

/**
 * 찍을 칸 — (반 × 학생)당 하나. `onlyEmpty`면 아직 안 찍은 칸만, 이미 같은 값인 칸은 건너뛴다(쓸 것이 없다).
 */
export function planBulkVideoCheck(
  rows: readonly BulkCheckRow[],
  ctx: BulkCheckContext,
  opts: { status: VideoHomeworkStatus; onlyEmpty: boolean },
): BulkCheckTarget[] {
  const out = new Map<string, BulkCheckTarget>();
  for (const row of rows) {
    if (!hasVideoCheckCell(row, ctx)) continue;
    const key = `${row.classId}:${row.studentId}`;
    if (out.has(key)) continue;
    const mark = ctx.marks.find((item) => item.classId === row.classId && item.studentId === row.studentId);
    if (mark && (opts.onlyEmpty || mark.status === opts.status)) continue;
    // 지난 수업일을 모르는 행은 이미 찍힌 기록의 숙제일을 지킨다(한 칸 저장과 같은 폴백) — null로 보내면 그 기록의 숙제일이 지워져
    // 영상 제출 현황의 그 회차에서 기록이 떨어져 나간다.
    out.set(key, { classId: row.classId, studentId: row.studentId, homeworkDate: row.homeworkDate ?? mark?.homeworkDate ?? null });
  }
  return [...out.values()];
}
