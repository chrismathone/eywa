"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import dynamic from "next/dynamic";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ATTITUDE } from "../attitude";
import { PreviousContent } from "./previous-content";
import { isBuiltinTemplateId, revertImplicit } from "../last-template";
import { canRemoveMakeupRow } from "../makeup-remove-plan";
import { REPORT_ATTACHMENT_MAX } from "../attachment-utils";
import { hasVideoAttachment } from "../report-video";
import { ProgressCard } from "./progress-card";
import { SheetSourceCard } from "./sheet-source-card";
import { TestCard } from "./test-card";
import { UnderstandingPanel } from "./understanding-panel";
import { LessonMemoInput } from "./lesson-memo-input";
import { isMathReportPilot, understandingRows } from "../math-report-pilot";
import { isHomeworkMissed, attitudeNeedsNote, needsAttitudeNote, type DailyTestSkip } from "../math-report-pilot-sections";
import { ReasonNoteInput } from "./reason-note-input";
import { hasMakeupAbsenceDate } from "../attendance-sentence";
import { rowMakeupFacts } from "../report-comment";
import { DailyTestSkipPanel } from "./daily-test-skip-panel";
import { HomeworkMissReasonInput } from "./homework-miss-reason";
import { ReportCard, type SubjectReport } from "./report-card";
import { EnglishTemplatePanel } from "./english-template-panel";
import { DEFAULT_ENGLISH_TEMPLATE, type ReportTemplate } from "@/features/report-templates/defaults";
import { usesWordTokens } from "../english-draft";
import { ONESCREEN_EMPTY_SPAN } from "./onescreen-card-layout";
import { rowKey, effectiveClassnoteStatus, isRowInputEditable } from "../grid";
import { resolveRowFields } from "../row-fields";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { OneScreenView } from "../view";
import type { useEnglishJj } from "./use-english-jj";
import type { useEnglishTemplateMode } from "./use-english-template-mode";
import type { useMakeupFlow } from "./use-makeup-flow";
import type { useMakeupPrev } from "./use-makeup-prev";
import type { useAutoWrite } from "./use-auto-write";
import type { useBulkOps } from "./use-bulk-ops";
import type { useReportAttachments } from "./use-report-attachments";
import type { useReportSend } from "./use-report-send";
import type { MakeupAttendanceDeps } from "./use-makeup-flow";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

// 템플릿 관리 창(2026-09-10) — 영어 행에서 '템플릿 관리'를 누를 때만 쓰므로 첫 로드에서 뺀다(B5 — 화면의 다른 지연 로드 뷰와 같은 이유).
const TemplateManager = dynamic(
  () => import("@/features/report-templates/components/template-manager").then((m) => m.TemplateManager),
  { ssr: false },
);

type CardProps = ComponentProps<typeof ReportCard>;
type Ret<T extends (...a: never[]) => unknown> = ReturnType<T>;

/** 화면 값(보기·권한·설정)과 진행 표시 — 전부 화면이 확정해 내린다. */
export type CardColumnContext = {
  view: OneScreenView;
  readonlyView: boolean;
  classnoteOn: boolean;
  showAttachments: boolean;
  showDailyTest: boolean;
  showCheckTest: boolean;
  allowTeacherTestMax: boolean;
  canEditAttendance: boolean;
  canLinkIjw: boolean;
  noticeMode: "A" | "B" | null;
  academyNoticeMode: "A" | "B";
  teacherName: string;
  activeDate: string;
  bulkGen: boolean;
  genSubject: string | null;
  attPending: Set<string>;
  attUrls: Record<string, string>;
  uploadingAttKey: string | null;
  prevLoaded: ReadonlySet<string>;
};

/** 지금 보는 학생의 과목 칩(행)과 보고서 state. */
export type CardColumnRow = {
  previewSubject: Subject | undefined;
  previewReport: SubjectReport | undefined;
  subjectIdx: number;
  reports: ReportsState;
  setReports: Dispatch<SetStateAction<ReportsState>>;
};

/** 카드(선택 학생) 래퍼 — 화면이 selected를 감싸 둔 세터들. */
export type CardColumnCardActions = {
  setAttitude: CardProps["onAttitude"];
  setHomework: CardProps["onHomework"];
  setTextbook: CardProps["onTextbook"];
  setHomeworkToday: CardProps["onHomeworkToday"];
  toggleMakeup: CardProps["onMakeup"];
  toggleVideoHomework: CardProps["onVideoHomework"];
  toggleVideoSubmitLink: CardProps["onVideoSubmitLink"];
  setVideoHomeworkDue: CardProps["onVideoHomeworkDue"];
  setSubjectDraft: CardProps["onSubjectDraft"];
  setSubjectTrend: CardProps["onSubjectTrend"];
  setNote: CardProps["onNote"];
  autoWriteSubject: Ret<typeof useAutoWrite>["autoWriteSubject"];
  sendSubject: Ret<typeof useReportSend>["sendSubject"];
  queueClassnote: Ret<typeof useReportSend>["queueClassnote"];
  revokeShare: Ret<typeof useReportSend>["revokeShare"];
  reissueShare: Ret<typeof useReportSend>["reissueShare"];
  addAttachments: Ret<typeof useReportAttachments>["addAttachments"];
  removeAttachment: Ret<typeof useReportAttachments>["removeAttachment"];
  confirmProgress: () => void;
  setProgress: (subjectIndex: number, today: string) => void;
  setProgressMode: (subjectIndex: number, mode: string | null) => void;
  setStudyGrade: (grade: string) => void;
  setScore: (which: "daily" | "check", v: number | null) => void;
  setMax: (which: "daily" | "check", v: number) => void;
  applySheetDraft: (subjectIndex: number) => void;
  setBulkOpen: Dispatch<SetStateAction<boolean>>;
  setCardSubject: Dispatch<SetStateAction<{ id: string; idx: number }>>;
  openNoticeForStudent: (studentId: string) => void;
};

/** (학생, 과목)을 받는 행 동작 — 표와 같은 함수. */
export type CardColumnRowActions = {
  removeMakeupRow: Ret<typeof useMakeupFlow>["removeMakeupRow"];
  pickMakeupClass: Ret<typeof useMakeupFlow>["pickMakeupClass"];
  joinMakeupRow: (student: OneScreenStudent, subjectName: string) => Promise<void>;
  splitMakeupRow: (student: OneScreenStudent, subjectName: string) => Promise<void>;
  checkMakeup: (student: OneScreenStudent, subjectName: string, outcome: "done" | "missed") => Promise<void>;
  isTrendHiddenFor: (studentId: string, subjectName: string) => boolean;
  toggleTrendHiddenFor: (studentId: string, subjectName: string) => void;
  setAttendanceFor: MakeupAttendanceDeps["setAttendanceFor"];
  importPrevFor: Ret<typeof useBulkOps>["importPrevFor"];
  loadMakeupPrev: Ret<typeof useMakeupPrev>["loadMakeupPrev"];
  setHomeworkMissReasonFor: (studentId: string, subjectName: string, reason: string) => void;
  setAttitudeNoteFor: (studentId: string, subjectName: string, note: string) => void;
  setMakeupReasonFor: (studentId: string, subjectName: string, reason: string) => void;
  setTestSkipFor: (studentId: string, subjectName: string, skip: DailyTestSkip | null) => void;
  setUnderstandingScoreFor: (studentId: string, subjectName: string, lesson: string, score: number | null) => void;
  toggleUnderstandingFor: (studentId: string, subjectName: string, lesson: string, off: boolean) => void;
  setAllUnderstandingFor: (studentId: string, subjectName: string, score: number) => void;
  setLessonMemoFor: (studentId: string, subjectName: string, memo: string) => void;
  addAttachmentsFor: Ret<typeof useReportAttachments>["addAttachmentsFor"];
};

/** 영어 행 템플릿 칸·관리 창. */
export type CardColumnEnglish = {
  englishTemplates: ReportTemplate[];
  setEnglishTemplates: Dispatch<SetStateAction<ReportTemplate[]>>;
  templateNotice: string | null;
  templateListFailed: boolean;
  templateManagerOpen: boolean;
  setTemplateManagerOpen: Dispatch<SetStateAction<boolean>>;
  findTemplate: Ret<typeof useEnglishTemplateMode>["findTemplate"];
  englishRowFlags: Ret<typeof useEnglishTemplateMode>["englishRowFlags"];
  englishJjStatusOf: Ret<typeof useEnglishTemplateMode>["englishJjStatusOf"];
  englishJjPickOf: Ret<typeof useEnglishTemplateMode>["englishJjPickOf"];
  copyEnglishText: Ret<typeof useEnglishTemplateMode>["copyEnglishText"];
  jj: ReturnType<typeof useEnglishJj>;
  rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  setEnglishTemplateFor: (student: OneScreenStudent, subjectName: string, templateId: string) => void;
  setNextTestFor: (studentId: string, subjectName: string, text: string) => void;
  setWordFeedbackFor: (studentId: string, subjectName: string, text: string) => void;
  setWordRetestFor: (studentId: string, subjectName: string, on: boolean) => void;
  refillEnglishFor: Ret<typeof useAutoWrite>["refillEnglishFor"];
  insertEnglishMediaFor: Ret<typeof useReportAttachments>["insertEnglishMediaFor"];
};

/**
 * 카드 뷰 가운데 열(보고서 작성) — 수정 계획 P3-O 10/10, `onescreen-client.tsx`의 `reportColumn` JSX를 그대로 옮긴 것.
 * 선택 학생이 없으면 '학생을 고르세요' 빈 칸. 상태는 전부 화면이 들고, 여기는 그리기와 배선만 한다
 * (화면 문구 사전은 같은 공급자에서 직접 읽는다).
 */
export function OneScreenCardColumn({
  selected,
  ctx: {
    view,
    readonlyView,
    classnoteOn,
    showAttachments,
    showDailyTest,
    showCheckTest,
    allowTeacherTestMax,
    canEditAttendance,
    canLinkIjw,
    noticeMode,
    academyNoticeMode,
    teacherName,
    activeDate,
    bulkGen,
    genSubject,
    attPending,
    attUrls,
    uploadingAttKey,
    prevLoaded,
  },
  row: { previewSubject, previewReport, subjectIdx, reports, setReports },
  card: {
    setAttitude,
    setHomework,
    setTextbook,
    setHomeworkToday,
    toggleMakeup,
    toggleVideoHomework,
    toggleVideoSubmitLink,
    setVideoHomeworkDue,
    setSubjectDraft,
    setSubjectTrend,
    setNote,
    autoWriteSubject,
    sendSubject,
    queueClassnote,
    revokeShare,
    reissueShare,
    addAttachments,
    removeAttachment,
    confirmProgress,
    setProgress,
    setProgressMode,
    setStudyGrade,
    setScore,
    setMax,
    applySheetDraft,
    setBulkOpen,
    setCardSubject,
    openNoticeForStudent,
  },
  rowActions: {
    removeMakeupRow,
    pickMakeupClass,
    joinMakeupRow,
    splitMakeupRow,
    checkMakeup,
    isTrendHiddenFor,
    toggleTrendHiddenFor,
    setAttendanceFor,
    importPrevFor,
    loadMakeupPrev,
    setHomeworkMissReasonFor,
    setAttitudeNoteFor,
    setMakeupReasonFor,
    setTestSkipFor,
    setUnderstandingScoreFor,
    toggleUnderstandingFor,
    setAllUnderstandingFor,
    setLessonMemoFor,
    addAttachmentsFor,
  },
  english: {
    englishTemplates,
    setEnglishTemplates,
    templateNotice,
    templateListFailed,
    templateManagerOpen,
    setTemplateManagerOpen,
    findTemplate,
    englishRowFlags,
    englishJjStatusOf,
    englishJjPickOf,
    copyEnglishText,
    jj,
    rowOutOfClass,
    setEnglishTemplateFor,
    setNextTestFor,
    setWordFeedbackFor,
    setWordRetestFor,
    refillEnglishFor,
    insertEnglishMediaFor,
  },
}: {
  selected: OneScreenStudent | null;
  ctx: CardColumnContext;
  row: CardColumnRow;
  card: CardColumnCardActions;
  rowActions: CardColumnRowActions;
  english: CardColumnEnglish;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  return (
selected ? (
            /* 가운데(보고서 작성) — 넘치면 이 열만 스크롤. 열 개수는 배율 상자 안 컨테이너 폭이 정한다.
               한 열로 쌓이면 높이를 압축하지 않고 페이지가 스크롤된다. 표의 상세 창은 기존 열 스크롤을 쓴다. */
            <div className="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1 @max-[846px]/oscard:overflow-visible">
              <header className="flex items-center gap-1.5">
                <EyIcon name="report" size={14} className="text-primary" />
                <h2 className="text-foreground text-sm font-bold">{t("os.c.reportHeading")}</h2>
                {view === "card" ? <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>{t("os.card.bulk")}</Button> : null}
                {classnoteOn ? (
                  <button
                    type="button"
                    onClick={() => openNoticeForStudent(selected.id)}
                    title={t("os.c.parentNoticeTitle")}
                    className="border-line text-text-dim hover:bg-bg-soft ml-auto rounded-lg border px-2 py-0.5 text-xs font-bold"
                  >
                    {t("os.c.parentNotice")}
                  </button>
                ) : null}
              </header>
              <ReportCard
                key={selected.id}
                readonlyView={readonlyView}
                // 숙제 미제출 사유(수학 보고서 시범) — 숙제 완성도가 미제출·0%일 때만, 그 칸 바로 아래에.
                homeworkExtra={
                  previewSubject &&
                  isMathReportPilot(selected.id, previewSubject.subjectKey) &&
                  isHomeworkMissed(resolveRowFields(selected, previewSubject).homework) ? (
                    <HomeworkMissReasonInput
                      value={previewSubject.homeworkMissReason ?? ""}
                      disabled={readonlyView || !isRowInputEditable(previewSubject, effectiveClassnoteStatus(previewReport?.classnoteStatus, previewSubject.classnoteStatus))}
                      onChange={(r) => setHomeworkMissReasonFor(selected.id, previewSubject.name, r)}
                    />
                  ) : null
                }
                // 수업 태도 의견(새 수학 보고서, 2026-10-26) — 태도가 하·중하일 때만, 태도 칸 바로 아래에. 3줄 이상(90자) 필수.
                attitudeExtra={
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
                  ) : null
                }
                // 보강 사유(2026-10-26) — 보강 줄인데 결석 날짜를 예약에서 못 찾을 때만(예약된 보강은 날짜·시간이 자동으로 들어간다).
                makeupExtra={(() => {
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
                })()}
                student={selected}
                reports={reports[selected.id] ?? {}}
                attitudes={ATTITUDE}
                onAttitude={setAttitude}
                onHomework={setHomework}
                onTextbook={setTextbook}
                onHomeworkToday={setHomeworkToday}
                onMakeup={toggleMakeup}
                onVideoHomework={toggleVideoHomework}
                onVideoSubmitLink={toggleVideoSubmitLink}
                onVideoHomeworkDue={setVideoHomeworkDue}
                onRemoveMakeup={(subjectName) => void removeMakeupRow(selected, subjectName)}
                onJoinMakeup={(subjectName) => void joinMakeupRow(selected, subjectName)}
                onSplitMakeup={(subjectName) => void splitMakeupRow(selected, subjectName)}
                onPickMakeupClass={(subjectName) => void pickMakeupClass(selected, subjectName)}
                onCheckMakeup={(subjectName, outcome) => void checkMakeup(selected, subjectName, outcome)}
                canRemoveMakeup={(subjectName) =>
                  canRemoveMakeupRow(reports[selected.id]?.[subjectName]?.classnoteStatus ?? null)
                }
                onSubjectDraft={setSubjectDraft}
                onSubjectTrend={setSubjectTrend}
                trendOptOut={{
                  hidden: (subjectName) => isTrendHiddenFor(selected.id, subjectName),
                  toggle: (subjectName) => toggleTrendHiddenFor(selected.id, subjectName),
                }}
                onNote={setNote}
                onAutoWrite={autoWriteSubject}
                generatingSubject={genSubject}
                onSend={sendSubject}
                onQueueClassnote={queueClassnote}
                onRevoke={revokeShare}
                onReissue={reissueShare}
                onAddFiles={addAttachments}
                onRemoveAttachment={removeAttachment}
                attachmentUrls={attUrls}
                uploadingSubject={
                  selected && uploadingAttKey?.startsWith(`${selected.id}::`)
                    ? uploadingAttKey.slice(selected.id.length + 2)
                    : null
                }
                attachmentsHidden={!showAttachments}
                attendance={{
                  readOnly: !canEditAttendance,
                  pendingKeys: attPending,
                  onSet: (classId, s, extra) => setAttendanceFor(selected.id, classId, s, extra),
                }}
                // 실효 모드 = 강사 오버라이드 ?? 학원 기본 — 상단 토글이 하단 보고서 입력 구성을 실제로 바꾼다.
                noticeMode={noticeMode ?? academyNoticeMode}
                // 과목 칩 선택을 부모가 들고 있다 — 옆 열 미리보기가 "지금 보는 과목"을 그려야 하기 때문.
                subjectIndex={subjectIdx}
                onSubjectIndex={(i) => setCardSubject({ id: selected.id, idx: i })}
                // 오늘 진도·테스트 = 이제 보고서 카드의 첫 열(2026-08-05 통합). 배선은 여기 그대로 두고
                // 카드엔 **노드만** 넘긴다(카드가 콜백 7개를 더 받으면 props 규칙이 무너진다).
                todayInputs={
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
                }
                // 영어 행 — 학부모 링크 복사도 발송·복사와 같은 확인을 거친다(링크는 저장된 글을 그대로 보여 준다).
                shareCopyWarning={
                  previewSubject?.subjectKey === "english" &&
                  englishRowFlags(selected, previewSubject, previewReport).outdated
                    ? t("os.tpl.outdatedLink")
                    : null
                }
                // 영어 행 템플릿 칸(2026-09-10) — 영어 행에서만 그린다(카드도 영어 행일 때만 이 자리를 쓴다).
                templatePanel={
                  previewSubject?.subjectKey === "english" ? (
                    <EnglishTemplatePanel
                      templates={englishTemplates}
                      state={{
                        // 고른 선택이 대기 중이면 그걸 보여 준다('AI 글 없음' 칩이 자동작성을 권한다).
                        templateId:
                          previewReport?.pendingTemplateId ?? previewReport?.templateId ?? DEFAULT_ENGLISH_TEMPLATE.id,
                        // 지금 글을 실제로 만든 템플릿 — 대기 중이면 칩이 그 이름을 함께 적는다(드롭다운과 글이 다를 때).
                        appliedTemplateId: previewReport?.templateId ?? DEFAULT_ENGLISH_TEMPLATE.id,
                        nextTest: previewReport?.nextTest ?? "",
                        wordFeedback: previewReport?.wordFeedback ?? "",
                        wordRetest: previewReport?.wordRetest === true,
                        // 단어 테스트 칸을 쓰는 템플릿(EiE 일일 보고서)일 때만 피드백·재시험 칸을 연다.
                        wordFields: usesWordTokens(
                          findTemplate(previewReport?.pendingTemplateId ?? previewReport?.templateId) ?? DEFAULT_ENGLISH_TEMPLATE,
                        ),
                        // 경고 셋은 저장값이 아니라 **지금 글·칸** 기준(english-draft.ts) — 새로고침·일괄 작성 뒤에도 맞다.
                        ...englishRowFlags(selected, previewSubject, previewReport),
                        jj: englishJjStatusOf(selected.id),
                        jjPick: englishJjPickOf(selected.id),
                        canLinkJj: canLinkIjw,
                        media: {
                          busy: uploadingAttKey === rowKey(selected.id, previewSubject.name),
                          full: (previewReport?.attachments?.length ?? 0) >= REPORT_ATTACHMENT_MAX,
                          hasVideo: hasVideoAttachment(previewReport?.attachments),
                        },
                      }}
                      notice={templateNotice ?? (templateListFailed ? t("os.tpl.listFailed") : null)}
                      handlers={{
                        onTemplate: (id) => setEnglishTemplateFor(selected, previewSubject.name, id),
                        onNextTest: (v) => setNextTestFor(selected.id, previewSubject.name, v),
                        onWordFeedback: (v) => setWordFeedbackFor(selected.id, previewSubject.name, v),
                        onWordRetest: (on) => setWordRetestFor(selected.id, previewSubject.name, on),
                        onRefill: () => void refillEnglishFor(selected, previewSubject.name),
                        onCopy: () => void copyEnglishText(selected, previewSubject.name),
                        onManage: () => setTemplateManagerOpen(true),
                        onJjRetry: () =>
                          void jj.ensure(selected.id, {
                            outOfClass: rowOutOfClass(selected, previewSubject),
                            force: true,
                            manual: true, // 사람이 누른 것 — 멈춤 차단기도 무시한다
                          }),
                        onJjPick: (pick) =>
                          void jj.choose(selected.id, pick, { outOfClass: rowOutOfClass(selected, previewSubject) }),
                        onInsertFile: (file) => void insertEnglishMediaFor(selected, previewSubject.name, file),
                        // 영상(2026-11-06) — 사진·PDF와 같은 올리기 함수(저장 보장·게이트 동일) · 글 속 자리 줄은 넣지 않는다.
                        onVideoFile: (file) => void addAttachmentsFor(selected, previewSubject.name, [file]),
                      }}
                    />
                  ) : null
                }
              />
              {templateManagerOpen ? (
                <TemplateManager
                  open
                  onOpenChange={setTemplateManagerOpen}
                  templates={englishTemplates}
                  onTemplatesChange={(list) => {
                    setEnglishTemplates(list);
                    // 관리 창에서 지운 사용자 템플릿을 기본값으로 붙여 둔 빈 행은 되돌린다(첫 목록 때와 같은 판정).
                    const ids = new Set(list.map((tp) => tp.id));
                    setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id) && !ids.has(id)));
                  }}
                  teacherName={teacherName}
                  notice={templateNotice ?? (templateListFailed ? t("os.tpl.listFailed") : null)}
                  // 미리보기 그림 칸의 예시 자료 날짜 — 보고 있는 날짜로(결과지 제출일·학습 기간이 그 날짜로 적힌다).
                  sampleDate={activeDate}
                />
              ) : null}
            </div>
        ) : (
          <div className={`bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm ${ONESCREEN_EMPTY_SPAN}`}>
            {t("os.c.pickStudent")}
          </div>
        )
  );
}
