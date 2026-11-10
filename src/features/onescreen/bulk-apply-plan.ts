/**
 * 값 일괄 적용(표 '일괄 입력')의 순수 재료 — 수정 계획 P3-O(batch C), `use-bulk-ops.ts`에서 옮김(본문 그대로).
 *
 *  · `bulkApplyTargetOf` = 표 한 줄 → `planBulkApply` 대상 한 줄(지금 행 값·영상 토글이 그려지는 조건·잠금).
 *  · `echoAttendanceUnits` = 일괄 출결에서 고른 수업타임을 새로 만든 칸에 되그릴 값(1 = null, 서버와 같은 정규화).
 */
import { effectiveClassnoteStatus, isRowInputEditable, type BulkTarget, type GridRow } from "./grid";
import { hasStoredUnderstanding, isMathReportPilot } from "./math-report-pilot";
import { resolveRowFields } from "./row-fields";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import type { BulkVideo } from "./components/bulk-ops-types";

/** 대상 한 줄을 만드는 데 드는 화면 값 — 영상 과제 정책·열람 전용·그 행의 최신 ClassNote 상태. */
export type BulkTargetCtx = Omit<BulkVideo, "videoHwStore"> & {
  readonlyView: boolean;
  liveClassnoteStatus: (studentId: string, subjectName: string) => string | null | undefined;
};

export function bulkApplyTargetOf(r: GridRow, ctx: BulkTargetCtx): BulkTarget {
  const { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, readonlyView, liveClassnoteStatus } = ctx;
  // 2026-10-02 추가 칸의 현재값은 **행 값**(row-fields.ts) — 표가 그리는 값과 같은 층을 본다.
  const rowEval = resolveRowFields(r.student, r.subject);
  return {
    studentId: r.student.id,
    subjectName: r.subject.name,
    subjectIndex: r.subjectIndex,
    subjectKey: r.subject.subjectKey ?? "math",
    today: r.subject.today ?? "",
    progressMode: r.subject.progressMode ?? null,
    // 이해도 단계(원장 2026-10-26) — 새 수학 보고서 행에만 넣는다 · '빈 칸만'은 아직 직접 매긴 점수가 없는 행에만.
    understandingOk: isMathReportPilot(r.student.id, r.subject.subjectKey),
    understandingStored: hasStoredUnderstanding(r.subject.today, r.subject.understanding),
    attitude: rowEval.attitude,
    attitudeNote: r.subject.attitudeNote ?? "",
    attitudeNoteOk: isMathReportPilot(r.student.id, r.subject.subjectKey),
    homeworkMissReason: r.subject.homeworkMissReason ?? "",
    dailyTestSkip: r.subject.dailyTestSkip ?? null,
    homework: rowEval.homework,
    textbook: r.subject.textbook ?? "",
    homeworkToday: r.subject.homeworkToday ?? "",
    note: rowEval.note,
    dailyScore: rowEval.tests.daily.score,
    dailyMax: rowEval.tests.daily.max,
    checkScore: rowEval.tests.check.score,
    checkMax: rowEval.tests.check.max,
    videoHomework: r.subject.videoHomework,
    videoSubmitLink: r.subject.videoSubmitLink,
    videoHomeworkDue: r.subject.videoHomeworkDue,
    // 행의 토글이 그려지는 조건과 같다(VideoHomeworkToggle · VideoSubmitLinkToggle) — 토글 없는 행엔 값을 넣지 않는다.
    // 다른 선생님이 처음 쓴 줄은 토글이 잠겨 있다 — 일괄 적용도 값을 넣지 않는다.
    videoOk:
      videoHwSaveOk && !!videoHwPolicy && !!r.subject.classId && !videoHwByOther(r.student.id, r.subject.classId) &&
      isVideoHomeworkEnabled(videoHwPolicy, { classId: r.subject.classId, subjectKey: r.subject.subjectKey ?? "math", grade: r.student.grade }),
    // 마감 — 행의 마감 토글과 같은 조건(영상 과제 토글이 있는 행 + 마감 칸 준비됨).
    dueOk:
      videoDueReady && videoHwSaveOk && !!videoHwPolicy && !!r.subject.classId && !videoHwByOther(r.student.id, r.subject.classId) &&
      isVideoHomeworkEnabled(videoHwPolicy, { classId: r.subject.classId, subjectKey: r.subject.subjectKey ?? "math", grade: r.student.grade }),
    linkOk:
      videoHwSaveOk && !videoHwByOther(r.student.id, r.subject.classId) &&
      submitLinkChoosable(submitLinkMode, videoHwPolicy, {
        classId: r.subject.classId, subjectKey: r.subject.subjectKey, grade: r.student.grade, studentName: r.student.name }),
    // 잠긴 행(발송 완료·결석)엔 값을 밀어 넣지 않는다 — 넣으면 강사가 **지울 수 없는 값**이 남는다.
    // ⚠️ 행 목록(rows)에서 빼지는 않는다: 아래 출결 일괄 적용이 같은 목록을 쓰는데 거기서 빠지면
    //    잘못 찍은 결석을 일괄로 되돌릴 수 없다(잠금의 유일한 탈출구를 막는 꼴).
    locked:
      readonlyView ||
      !isRowInputEditable(
        r.subject,
        effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
      ),
  };
}

/** 일괄 출결의 수업타임 입력 → 새로 만든 칸에 되그릴 시수. 안 고름 = undefined(서버 자동 시수), 1·숫자 아님 = null. */
export function echoAttendanceUnits(attendanceUnits: string): number | null | undefined {
  return attendanceUnits
    ? (() => {
        const n = Number(attendanceUnits.replace(",", "."));
        return !Number.isFinite(n) || n === 1 ? null : n;
      })()
    : undefined;
}
