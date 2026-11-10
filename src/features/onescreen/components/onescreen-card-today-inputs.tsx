"use client";

import type { ReactNode } from "react";
import { PreviousContent } from "./previous-content";
import { ProgressCard } from "./progress-card";
import { SheetSourceCard } from "./sheet-source-card";
import { TestCard } from "./test-card";
import { UnderstandingPanel } from "./understanding-panel";
import { LessonMemoInput } from "./lesson-memo-input";
import { DailyTestSkipPanel } from "./daily-test-skip-panel";
import { isMathReportPilot, understandingRows } from "../math-report-pilot";
import { effectiveClassnoteStatus, isRowInputEditable } from "../grid";
import { resolveRowFields } from "../row-fields";
import type { OneScreenStudent } from "../types";
import type { useSheetTf } from "@/features/teacher-view/lang-context";
import type { CardColumnCardActions, CardColumnContext, CardColumnRow, CardColumnRowActions } from "./onescreen-card-types";

/**
 * 보고서 카드의 첫 열 '오늘 진도·테스트' — 수정 계획 P3-O batch D, `onescreen-card-column.tsx`에서 옮김(JSX 그대로).
 * 오늘 진도·테스트 = 이제 보고서 카드의 첫 열(2026-08-05 통합). 배선은 여기 그대로 두고
 * 카드엔 **노드만** 넘긴다(카드가 콜백 7개를 더 받으면 props 규칙이 무너진다).
 * 컴포넌트가 아니라 **그리기 함수**다(예전과 같은 요소 트리 — 카드가 받는 노드가 그대로다).
 */
export function cardTodayInputs({
  selected,
  ctx: { readonlyView, bulkGen, prevLoaded, showDailyTest, showCheckTest, allowTeacherTestMax },
  row: { previewSubject, previewReport, subjectIdx, reports },
  card: { applySheetDraft, confirmProgress, setProgress, setProgressMode, setStudyGrade, setScore, setMax },
  rowActions: {
    importPrevFor,
    loadMakeupPrev,
    setTestSkipFor,
    setUnderstandingScoreFor,
    toggleUnderstandingFor,
    setAllUnderstandingFor,
    setLessonMemoFor,
  },
  tf,
}: {
  selected: OneScreenStudent;
  ctx: Pick<CardColumnContext, "readonlyView" | "bulkGen" | "prevLoaded" | "showDailyTest" | "showCheckTest" | "allowTeacherTestMax">;
  row: Pick<CardColumnRow, "previewSubject" | "previewReport" | "subjectIdx" | "reports">;
  card: Pick<
    CardColumnCardActions,
    "applySheetDraft" | "confirmProgress" | "setProgress" | "setProgressMode" | "setStudyGrade" | "setScore" | "setMax"
  >;
  rowActions: Pick<
    CardColumnRowActions,
    | "importPrevFor"
    | "loadMakeupPrev"
    | "setTestSkipFor"
    | "setUnderstandingScoreFor"
    | "toggleUnderstandingFor"
    | "setAllUnderstandingFor"
    | "setLessonMemoFor"
  >;
  tf: ReturnType<typeof useSheetTf>;
}): ReactNode {
  return (
    <>
      {/* 이 값들이 **어디서 왔는지**를 입력 바로 위에서 밝힌다(ECS 시트 초안). */}
      {previewSubject ? (
        <SheetSourceCard
          subject={previewSubject}
          onApply={() => applySheetDraft(subjectIdx)}
        />
      ) : null}
      {previewSubject ? <PreviousContent subject={previewSubject}
        onImport={!readonlyView && !bulkGen && isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))
          ? () => importPrevFor(selected, previewSubject.name) : undefined} /> : null}
      <ProgressCard
        embedded
        student={selected}
        lockedSubjects={selected.subjects.filter(su => !isRowInputEditable(su, effectiveClassnoteStatus(reports[selected.id]?.[su.name]?.classnoteStatus, su.classnoteStatus))).map(su => su.name)}
        onConfirm={confirmProgress}
        onProgress={setProgress}
        onProgressMode={setProgressMode}
        onStudyGrade={setStudyGrade}
        onLoadPrev={
          selected.isMakeup && !prevLoaded.has(selected.id)
            ? () => loadMakeupPrev(selected.id)
            : undefined
        }
      />
      {previewSubject && isMathReportPilot(selected.id, previewSubject.subjectKey) && showDailyTest ? (
        <DailyTestSkipPanel
          skip={previewSubject.dailyTestSkip ?? null}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          onChange={(skip) => setTestSkipFor(selected.id, previewSubject.name, skip)}
        />
      ) : null}
      <TestCard
        embedded
        student={{ ...selected, subjects: previewSubject ? [previewSubject] : [] }}
        // 선택된 행의 점수를 보여준다 — 쓰기(setScore)도 그 행에 간다(row-fields.ts).
        tests={resolveRowFields(selected, previewSubject).tests}
        onScore={setScore}
        allowMax={allowTeacherTestMax}
        onMax={setMax}
        // 수학 보고서 시범에서 '시험 없음'을 고르면 점수 칸을 감춘다(사유 칸이 그 자리를 대신한다).
        dailyEnabled={showDailyTest && !(previewSubject && isMathReportPilot(selected.id, previewSubject.subjectKey) && previewSubject.dailyTestSkip)}
        checkEnabled={showCheckTest}
      />
      {/* 소단원별 이해도(수학 보고서 시범, 테스트 학생 한정) — 자동작성 재료. */}
      {previewSubject && isMathReportPilot(selected.id, previewSubject.subjectKey) ? (
        <UnderstandingPanel
          rows={understandingRows(previewSubject.today, previewSubject.understanding)}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          onScore={(lesson, score) => setUnderstandingScoreFor(selected.id, previewSubject.name, lesson, score)}
          onToggle={(lesson, off) => toggleUnderstandingFor(selected.id, previewSubject.name, lesson, off)}
          onAll={(score) => setAllUnderstandingFor(selected.id, previewSubject.name, score)}
        />
      ) : null}
      {/* '오늘의 수업' 메모(원장 2026-10-28) — 그날 한 일을 적으면 AI가 '오늘의 수업'에 녹여 쓴다. 표와 같은 칸. */}
      {previewSubject && isMathReportPilot(selected.id, previewSubject.subjectKey) ? (
        <LessonMemoInput
          value={previewSubject.lessonMemo ?? ""}
          disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
          ariaLabel={tf("os.memo.aria", { name: selected.name })}
          onChange={(v) => setLessonMemoFor(selected.id, previewSubject.name, v)}
        />
      ) : null}
    </>
  );
}
