/**
 * 표 일괄 작업 훅들(use-bulk-ops·use-bulk-apply·use-bulk-copy·use-prev-import)이 함께 쓰는 매개변수 모양.
 * 화면이 그대로 넘긴다 — 훅마다 필요한 칸만 꺼내 쓴다.
 */
import type { Dispatch, SetStateAction } from "react";
import type { OneScreenStudent } from "../types";
import type { DailyTestSkip } from "../math-report-pilot-sections";
import type { DisplayOptions } from "../display-options";
import type { SubjectReport } from "./report-card";
import type {
  useSubmitLinkMode,
  useVideoHomeworkOthersReport,
  useVideoHomeworkPolicy,
  useVideoHomeworkStore,
} from "@/features/video-homework/components/video-homework-provider";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 화면의 행 단위 세터 — 일괄 적용·맨 위 행 복사·이전 회차 가져오기가 행마다 부른다(행 편집과 같은 함수 · 순서 그대로). */
export type BulkRowSetters = {
  setAttitudeValue: (studentId: string, subjectName: string, a: string | null) => void;
  setAttitudeNoteFor: (studentId: string, subjectName: string, note: string) => void;
  setHomeworkValue: (studentId: string, subjectName: string, h: string) => void;
  setHomeworkMissReasonFor: (studentId: string, subjectName: string, reason: string) => void;
  setTextbookFor: (studentId: string, subjectName: string, text: string) => void;
  setHomeworkTodayFor: (studentId: string, subjectName: string, text: string) => void;
  setProgressFor: (studentId: string, subjectIndex: number, today: string) => void;
  setProgressModeFor: (studentId: string, subjectIndex: number, mode: string | null) => void;
  setAllUnderstandingFor: (studentId: string, subjectName: string, score: number) => void;
  toggleUnderstandingFor: (studentId: string, subjectName: string, lesson: string, off: boolean) => void;
  setNoteFor: (studentId: string, subjectName: string, text: string) => void;
  setMaxFor: (studentId: string, subjectName: string, which: "daily" | "check", v: number) => void;
  setScoreFor: (studentId: string, subjectName: string, which: "daily" | "check", v: number | null) => void;
  setTestSkipFor: (studentId: string, subjectName: string, skip: DailyTestSkip | null) => void;
  rememberVideoDue: (mode: "week" | "next") => void;
  patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
  patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
};

/** 표시 집합 — 대상 행은 늘 이 값에서 만든다(표시 목록과 일괄 대상이 같은 집합). */
export type BulkView = {
  visible: OneScreenStudent[];
  activeClassFilter: string | null;
  classTags: readonly string[];
  displaySettings: { options: Pick<DisplayOptions, "sort"> };
};

export type BulkVideo = {
  videoHwSaveOk: boolean;
  videoHwPolicy: ReturnType<typeof useVideoHomeworkPolicy>;
  videoHwByOther: ReturnType<typeof useVideoHomeworkOthersReport>;
  videoDueReady: boolean;
  submitLinkMode: ReturnType<typeof useSubmitLinkMode>;
  videoHwStore: ReturnType<typeof useVideoHomeworkStore>;
};

export type BulkAttendance = {
  setAttPending: Dispatch<SetStateAction<Set<string>>>;
  applyAttendanceLocal: (
    studentId: string,
    classId: string,
    raw: string | null,
    extra?: { note?: string | null; units?: number | null },
  ) => void;
};

export type BulkI18n = { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };

/** 그 행의 **최신** ClassNote 상태(화면 state가 로스터 스냅샷을 이긴다). */
export type LiveClassnoteStatus = (studentId: string, subjectName: string) => string | null | undefined;
