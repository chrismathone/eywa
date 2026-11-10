/**
 * 카드 뷰 가운데 열(OneScreenCardColumn)의 묶음 props 모양 — 수정 계획 P3-O batch D, `onescreen-card-column.tsx`에서 옮김.
 * 화면이 이 다섯 묶음(ctx · row · card · rowActions · english)으로 넘기고, 열과 열의 그리기 함수들이 필요한 칸만 꺼내 쓴다.
 */
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { ReportCard, SubjectReport } from "./report-card";
import type { ReportTemplate } from "@/features/report-templates/defaults";
import type { DailyTestSkip } from "../math-report-pilot-sections";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { OneScreenView } from "../view";
import type { useEnglishJj } from "./use-english-jj";
import type { useEnglishTemplateMode } from "./use-english-template-mode";
import type { useMakeupFlow, MakeupAttendanceDeps } from "./use-makeup-flow";
import type { useMakeupPrev } from "./use-makeup-prev";
import type { useAutoWrite } from "./use-auto-write";
import type { useBulkOps } from "./use-bulk-ops";
import type { useReportAttachments } from "./use-report-attachments";
import type { useReportSend } from "./use-report-send";

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
  setAttitude: CardProps["rowActions"]["onAttitude"];
  setHomework: CardProps["rowActions"]["onHomework"];
  setTextbook: CardProps["rowActions"]["onTextbook"];
  setHomeworkToday: CardProps["rowActions"]["onHomeworkToday"];
  toggleMakeup: CardProps["rowActions"]["onMakeup"];
  toggleVideoHomework: CardProps["rowActions"]["onVideoHomework"];
  toggleVideoSubmitLink: CardProps["rowActions"]["onVideoSubmitLink"];
  setVideoHomeworkDue: CardProps["rowActions"]["onVideoHomeworkDue"];
  setSubjectDraft: CardProps["rowActions"]["onSubjectDraft"];
  setSubjectTrend: CardProps["rowActions"]["onSubjectTrend"];
  setNote: CardProps["rowActions"]["onNote"];
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
