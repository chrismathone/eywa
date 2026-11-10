"use client";

import type { ReactNode } from "react";
import { isMathReportPilot } from "../math-report-pilot";
import { isHomeworkMissed, attitudeNeedsNote, needsAttitudeNote } from "../math-report-pilot-sections";
import { ReasonNoteInput } from "./reason-note-input";
import { hasMakeupAbsenceDate } from "../attendance-sentence";
import { rowMakeupFacts } from "../report-comment";
import { HomeworkMissReasonInput } from "./homework-miss-reason";
import { effectiveClassnoteStatus, isRowInputEditable } from "../grid";
import { resolveRowFields } from "../row-fields";
import type { OneScreenStudent } from "../types";
import type { CardColumnContext, CardColumnRow, CardColumnRowActions } from "./onescreen-card-types";

/**
 * 보고서 카드의 사유 칸 셋(숙제 미제출 · 수업 태도 의견 · 보강 사유) — 수정 계획 P3-O batch D, `onescreen-card-column.tsx`에서 옮김(식 그대로).
 * 컴포넌트가 아니라 **그리기 함수**다 — 조건이 안 맞으면 예전처럼 `null`을 돌려준다(카드가 그 자리를 비운다 · 요소 트리 그대로).
 */
export function cardReasonSlots({
  selected,
  ctx: { readonlyView },
  row: { previewSubject, previewReport },
  rowActions: { setHomeworkMissReasonFor, setAttitudeNoteFor, setMakeupReasonFor },
}: {
  selected: OneScreenStudent;
  ctx: Pick<CardColumnContext, "readonlyView">;
  row: Pick<CardColumnRow, "previewSubject" | "previewReport">;
  rowActions: Pick<CardColumnRowActions, "setHomeworkMissReasonFor" | "setAttitudeNoteFor" | "setMakeupReasonFor">;
}): { homeworkExtra: ReactNode; attitudeExtra: ReactNode; makeupExtra: ReactNode } {
  return {
    // 숙제 미제출 사유(수학 보고서 시범) — 숙제 완성도가 미제출·0%일 때만, 그 칸 바로 아래에.
    homeworkExtra:
      previewSubject &&
      isMathReportPilot(selected.id, previewSubject.subjectKey) &&
      isHomeworkMissed(resolveRowFields(selected, previewSubject).homework) ? (
        <HomeworkMissReasonInput
          value={previewSubject.homeworkMissReason ?? ""}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          onChange={(r) => setHomeworkMissReasonFor(selected.id, previewSubject.name, r)}
        />
      ) : null,
    // 수업 태도 의견(새 수학 보고서, 2026-10-26) — 태도가 하·중하일 때만, 태도 칸 바로 아래에. 3줄 이상(90자) 필수.
    attitudeExtra:
      previewSubject &&
      isMathReportPilot(selected.id, previewSubject.subjectKey) &&
      attitudeNeedsNote(resolveRowFields(selected, previewSubject).attitude) ? (
        <ReasonNoteInput
          multiline
          value={previewSubject.attitudeNote ?? ""}
          done={!needsAttitudeNote(resolveRowFields(selected, previewSubject).attitude, previewSubject.attitudeNote)}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          labelKey="os.card.attNote.label"
          placeholderKey="os.card.attNote.ph"
          onChange={(v) => setAttitudeNoteFor(selected.id, previewSubject.name, v)}
        />
      ) : null,
    // 보강 사유(2026-10-26) — 보강 줄인데 결석 날짜를 예약에서 못 찾을 때만(예약된 보강은 날짜·시간이 자동으로 들어간다).
    makeupExtra: (() => {
      if (!previewSubject) return null;
      const mk = rowMakeupFacts(selected, previewSubject);
      if (!mk?.row || hasMakeupAbsenceDate(mk)) return null;
      return (
        <ReasonNoteInput
          value={previewSubject.makeupReason ?? ""}
          done={(previewSubject.makeupReason ?? "").trim() !== ""}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          labelKey="os.card.mkReason.label"
          placeholderKey="os.card.mkReason.ph"
          onChange={(v) => setMakeupReasonFor(selected.id, previewSubject.name, v)}
        />
      );
    })(),
  };
}
