"use client";

import { registerMakeupEntries } from "../server/makeup-register-actions";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import { setMakeupClass } from "../server/makeup-class-actions";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { beginWriteOrigin, markAutowrite, markWrite, queueWriteTiming, withWriteOrigin } from "../write-timing-store";
import type { SendMode, WriteField, WriteView } from "../write-timing";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { kstToday, monthDayLabel } from "@/lib/date-kst";
import type { SavedVideoHomeworkDue } from "@/features/video-homework/due";
import { usePrintWindow } from "@/components/workspace/print-window";
import { CLASS_TAGS, TODAY } from "../data";
import { ATTITUDE } from "../attitude";
import { CLASSNOTE_ONLY_VIEWS, type OneScreenView } from "../view";
import { buildSubjectReport } from "../report";
import { buildReportCommentInput } from "../report-comment";
// 저장·미리보기 공용 필드 조립(단일 소스) — 미리보기가 발송본과 갈라지지 않게.
import { buildExamInfo as buildExamInfoOf, buildReportFields } from "../report-fields";
import {
  buildMakeupStudent,
  loadMakeupHistory,
  loadReportTrend,
  generateReportComment,
  reissueShareLink,
  revokeShareLink,
  saveAndQueueClassnote,
  saveLessonReport,
  saveOnescreenSession,
  setMyNoticeMode,
  setMyOnescreenFontSize,
  setMyLastReportTemplate,
  setMyTrendOptOut,
} from "../server/actions";
import { DisplayOptionsProvider, useDisplayOptionsState } from "./display-options-context";
import { orderReportRows } from "../report-row-order";
import type { DisplayOptions } from "../display-options";
import { PreviousContent } from "./previous-content";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isJjSheetDraft, isJjSheetReport, isProgressOptionalReport } from "../jj-books";
import {
  EMPTY_TEMPLATE_PREFS,
  implicitTemplateFor,
  isBuiltinTemplateId,
  rememberTemplate,
  retargetImplicit,
  revertImplicit,
  settleImplicit,
  type TemplatePrefs,
} from "../last-template";
import { isTrendOptedOut, trendOptOutKey } from "../trend-optout";
import { removeMakeupEntry } from "../server/makeup-remove-actions";
import { checkMakeupReservation, moveReservationToRegular, setReservationReportMode } from "@/features/attendance/server/makeup-reservation-actions";
import { joinMakeupContent, joinText, planJoinMakeup, planSplitMakeup, type MakeupSwitchBlock } from "../makeup-switch";
import { logOnescreenBulkApply } from "../server/bulk-log-actions";
import { canRemoveMakeupRow, makeupRemoveBlockReason } from "../makeup-remove-plan";
import { makeupRowName } from "../makeup-label";
import { isBoardBlockedStatus, isBoardWaitStatus } from "../send-class";
import { MakeupAdder } from "./makeup-adder";
import { SendWindowNotice } from "./send-window-notice";
import { EmbedAnchor } from "@/components/embed-link";
import {
  issueReportAttachmentUploadTicket,
  registerReportAttachment,
  removeReportAttachment,
  signReportAttachmentUrls,
} from "../server/attachment-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import { ENGLISH_DRAFT_TEXTAREA_ID, REPORT_ATTACHMENT_MAX, uniqueAttachmentName } from "../attachment-utils";
import type { CellState, OneScreenStudent, Subject } from "../types";
import dynamic from "next/dynamic";
import { OneScreenTopBar } from "./top-bar";
import { CLASS_TAG_ALL } from "../class-tags";
import { StudentList } from "./student-list";
import { buildSendMark } from "../send-mark";
import { SentReportNotice } from "./sent-report-notice";
import type { TodayClass } from "../server/roster";
import { ProgressCard } from "./progress-card";
import { SheetSourceCard } from "./sheet-source-card";
import { TestCard } from "./test-card";
import { UnderstandingPanel } from "./understanding-panel";
import { LessonMemoInput } from "./lesson-memo-input";
import {
  activeUnderstanding,
  EMPTY_UNDERSTANDING,
  isMathReportPilot,
  isPilotAutoWritten,
  isPilotGateError,
  pilotCanEdit,
  pilotRecomposeNote,
  PILOT_SECTION_TITLES,
  setAllUnderstanding,
  hasStoredUnderstanding,
  understandingRows,
  type UnderstandingState,
} from "../math-report-pilot";
import { isHomeworkMissed, pilotRowSig, type DailyTestSkip } from "../math-report-pilot-sections";
import { needsMakeupCheck } from "../reserved-makeup";
import { MAKEUP_CHECK_REQUIRED_ERROR } from "@/features/attendance/makeup-check-error";
import { mergePilotDraft, pilotSectionBody } from "../pilot-merge";
import { REASON_BLOCKS, pilotSendBlocks } from "../pilot-send-gate";
import { ReasonNoteInput } from "./reason-note-input";
import { attitudeNeedsNote, needsAttitudeNote } from "../math-report-pilot-sections";
import { hasMakeupAbsenceDate } from "../attendance-sentence";
import { rowMakeupFacts } from "../report-comment";
import { DailyTestSkipPanel } from "./daily-test-skip-panel";
import { HomeworkMissReasonInput } from "./homework-miss-reason";
import { ReportCard, type SubjectReport } from "./report-card";
// 영어 템플릿 모드(2026-09-10) — 영어 행은 멘트 대신 템플릿 글(수학 경로 불변).
import { EnglishTemplatePanel } from "./english-template-panel";
import { generateEnglishMent } from "../server/english-ment-actions";
import { listMyReportTemplates } from "@/features/report-templates/server/actions";
import {
  BUILTIN_ENGLISH_TEMPLATES,
  DEFAULT_ENGLISH_TEMPLATE,
  type ReportTemplate,
} from "@/features/report-templates/defaults";
import { attendanceSentence } from "../attendance-sentence";
import { progressWithMode } from "../progress-mode";
import { hasTextBesidesMarkers, stripImageSlots, usedAttachmentNames } from "@/features/report-templates/image-slots";
import {
  attachmentLineIndex,
  carryAttachmentLines,
  hasTextBesidesAttachments,
  insertAttachmentLine,
  removeAttachmentLines,
  withoutAttachmentLines,
} from "@/features/report-templates/attachment-lines";
import { englishTestText } from "@/features/report-templates/values";
// 영어 행 인재원 하루치(2026-09-11) — 그림 칸(시험 결과지·학습 분석지) 재료. 카드로 연 행만 받는다.
import { useEnglishJj } from "./use-english-jj";
import { jjDayKey, jjDaySummary, jjKnownSlots, type JjDayCache } from "../jj-day";
import type { EnglishJjStatus } from "./english-template-panel";
import type { JjExamPickState } from "./english-jj-exam-picker";
import {
  aiFactsHashOf,
  canRecompose,
  composeEnglishDraft,
  findTemplateIn,
  factTokensOf,
  isAiStale,
  isNameMissing,
  isTemplateStale,
  isTextOutdated,
  isUntouchedTemplateDraft,
  templateHashOf,
  needsAiFirst,
  outputAckKey,
  pendingNeedsAi,
  slotFactsFor,
  templateFactsKey,
  templateCarriesNote,
  templateImageSlots,
  templateNeedsAi,
  type EnglishGenStatus,
  type EnglishRowFacts,
} from "../english-draft";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { reportOptoutNotice } from "@/features/classes/report-optout";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { ReportPreview, type ReportPreviewContext } from "./report-preview";
import {
  ONESCREEN_CARD_FRAME,
  ONESCREEN_CARD_GRID,
  ONESCREEN_EMPTY_SPAN,
  ONESCREEN_PREVIEW_BUTTON,
  ONESCREEN_PREVIEW_DIALOG_SCROLL,
  ONESCREEN_PREVIEW_SCROLL,
  ONESCREEN_PREVIEW_SLOT,
  ONESCREEN_PREVIEW_WIDTH_PX,
} from "./onescreen-card-layout";
import type { TrendReportRow } from "../report-trend";
import type { ReportSettings } from "@/features/owner/settings-types";
/**
 * 카드 아님 뷰 4종은 **지연 로드**(B5) — 기본 뷰는 카드이고 이 넷은 강사가 탭을 눌러야 그린다.
 * 정적 import면 네 파일(격자 430줄 · 발송현황 280 · 발송달력 296 · 공지작성 536 = 1,540여 줄)이
 * 전원이 매일 여는 첫 로드에 통째로 실린다. 창(iframe)마다 JS를 처음부터 다시 실행하는 구조라
 * (docs/perf-open-window-backlog.md 실측: 지배 항목은 서버가 아니라 뷰어 PC의 클라 실행) 첫 화면이
 * 안 그리는 코드를 첫 로드에서 빼는 것이 가장 곧은 레버다.
 *
 * ⚠️ `ssr: false` — 넷 다 클라 상호작용 전용이라 서버에서 미리 그릴 이유가 없다(부모가 이미
 *    클라 컴포넌트라 이 옵션이 허용된다). 전환 순간의 빈 화면은 `loading` 스켈레톤이 덮는다.
 */
const ViewSkeleton = () => (
  <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
);
const OneScreenGrid = dynamic(() => import("./onescreen-grid").then((m) => m.OneScreenGrid), {
  ssr: false,
  loading: ViewSkeleton,
});
const StatusBoard = dynamic(() => import("./status-board").then((m) => m.StatusBoard), {
  ssr: false,
  loading: ViewSkeleton,
});
const SendCalendarBoard = dynamic(() => import("./send-calendar").then((m) => m.SendCalendarBoard), {
  ssr: false,
  loading: ViewSkeleton,
});
const NoticeComposer = dynamic(() => import("./notice-composer").then((m) => m.NoticeComposer), {
  ssr: false,
  loading: ViewSkeleton,
});
// 템플릿 관리 창(2026-09-10) — 영어 행에서 '템플릿 관리'를 누를 때만 쓰므로 첫 로드에서 뺀다(B5, 위와 같은 이유).
const TemplateManager = dynamic(
  () => import("@/features/report-templates/components/template-manager").then((m) => m.TemplateManager),
  { ssr: false },
);
import {
  buildGridRows,
  rowKey,
  effectiveClassnoteStatus,
  isAlreadySent,
  isAttendanceUnchecked,
  isClassMember,
  isCopyTargetRow,
  isReportOptoutRow,
  isRowInputEditable,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  isReportEligible,
  planBulkPrevFill,
  planPrevComments,
  planCopyFirstRow,
  rowClassName,
  rowInClass,
  studentInClass,
  summarizeSendGaps,
  type BulkPatch,
  type PrevCommentPlan,
  type RowAction,
} from "../grid";
import {
  describeAttendanceSkips,
  planBulkAttendance,
  type BulkAttendanceStatus,
} from "../bulk-attendance";
import { planQuickPresent } from "../quick-attendance";
import {
  DEFAULT_ONESCREEN_FONT_SIZE,
  ONESCREEN_FONT_SIZE_ZOOM,
  type OnescreenFontSize,
} from "../font-size";
import {
  getClassNarratives,
  getServerClassNarratives,
  setClassNarrative,
  subscribeClassNarratives,
} from "../class-narrative-store";
import {
  applyWriteFilter,
  countByWriteFilter,
  isStudentWritten,
  matchesWriteFilter,
  type WriteFilter,
} from "../write-filter";
import { applyStudentOrder } from "../student-order";
import { saveStudentOrder } from "../server/order-actions";
import { useClassnoteStatusSync } from "./use-classnote-status-sync";
import { useLiveClassnoteMatch } from "./use-live-classnote-match";
import { cnSyncRequested } from "../classnote-match-live";
import { mergeClassnoteStatuses, pendingSendStudentIds, type ClassnoteStatusRow } from "../classnote-status";
import { linkMakeupToAbsence, setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import { subscribeAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { applyAppliedAttendance } from "../apply-applied-attendance";
import { studentMarkFromRows } from "../attendance-mark";
import { STATUS_TEXT, statusTextOf } from "@/features/attendance/cell-display";
import type { AttendanceSelection } from "./attendance-pills";
import { useEditPresence, useEditingOthers } from "@/features/presence/edit-presence";
import { dedupeEditors } from "@/features/presence/presence-state";
import {
  MakeupConfirmDialog,
  type MakeupConfirmChoice,
} from "@/features/attendance/components/makeup-confirm-dialog";
import { fetchMakeupAbsences, fetchMakeupHostClasses } from "@/features/attendance/server/makeup-actions";
import { defaultHostClassId, hostChoicesFor, type MakeupHostClass } from "@/features/attendance/makeup-host";
import { noteMakeupAgainstAbsence } from "@/features/attendance/server/makeup-note-action";
import type { MakeupAbsenceList } from "@/features/attendance/makeup-options";
import { mergeStatusOf, planMakeupMerge, type MergeCandidate } from "../makeup-merge-plan";
import { hasRowOverrides, resolveRowFields, seedRowFields } from "../row-fields";
import { detectClassNotices } from "../class-notice";
import { shortDate } from "../makeup-absence-link";
import { computeClientMentSource } from "../ment-source";
import { cnLabelFor, CN_SUBJECT_KEYS, type CnMatchMap } from "../classnote-match";
import { SendClassDialog, type SendClassAsk } from "./send-class-dialog";
import { ClassnoteOnProvider } from "./classnote-on-context";
import { useSubmitLinkMode, useVideoHomeworkDueReady, useVideoHomeworkOthersReport, useVideoHomeworkPolicy, useVideoHomeworkSaveOk, useVideoHomeworkStore } from "@/features/video-homework/components/video-homework-provider";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { planBulkVideoCheck } from "@/features/video-homework/bulk-check";
import { expectedVideoDue, videoDueTextMismatch } from "@/features/video-homework/due-text-check";
import { setMyVideoDueDefault } from "../server/video-due-pref-actions";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";

/** 아직 안 불러왔을 때의 빈 결석 후보 한 벌 — 확인창은 이걸 받아 '직접 입력'만 보여 준다. */
const EMPTY_ABSENCES: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };
/** ClassNote 기능이 꺼진 학원 — 발송 상태 감시 대상 없음(참조 고정이라 감시 훅이 매 렌더 재시작하지 않는다). */
const NO_PENDING: string[] = [];

/**
 * 반 필터가 '전체'라 앵커가 없을 때의 **보조 앵커** — 합칠 정규 행(후보)의 반을 기준으로 삼는다.
 *
 * 🔴 이 경로가 비어 있으면 안 되는 이유: 후보를 고른 보강은 앵커가 없어도 결석분을 **실제로 쓴다**
 *    (`linkMakeupAbsence`가 `choice.absentClassId`로 그 칸에 메모를 붙인다). 즉 '전체'로 두고 합침/분리를
 *    고르면 수학 보강이 영어 결석 칸에 메모를 남길 수 있었다 — 고치려던 바로 그 사고다.
 * ⚠️ **후보가 한 과목일 때만** 쓴다(겸직 강사는 후보가 두 과목일 수 있고, 그때 첫 후보로 좁히면 다른 과목
 *    결석이 통째로 사라진다). 모르면 안 거른다 — 이 파일의 다른 폴백과 같은 비대칭.
 */
function candidateAnchorClassId(candidates: readonly MergeCandidate[]): string | null {
  const keys = new Set(candidates.map((c) => c.subjectKey).filter(Boolean));
  return keys.size === 1 ? (candidates[0]?.classId ?? null) : null;
}

type ReportsState = Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → {draft, sent}

/** 보강 보고서 합치기 ↔ 나누기가 막힌 이유 → 문구(makeup-switch.ts). */
const SWITCH_BLOCK_KEY = {
  sent: "os.switch.blockSent",
  noRegular: "os.switch.blockNoRegular",
  attendance: "os.switch.blockAttendance",
  alreadyMerged: "os.switch.blockAlreadyMerged",
  optout: "os.switch.blockOptout",
  hasSeparate: "os.switch.blockHasSeparate",
  gone: "os.switch.blockGone",
  noAnchor: "os.switch.blockNoAnchor",
  reservedDone: "os.switch.blockReservedDone",
} as const satisfies Record<MakeupSwitchBlock, string>;

/**
 * @param templatePrefs 영어 보고서 템플릿 내 기본값(반별 마지막 선택, last-template.ts) — **글이 없고 안 보낸** 영어 행에만,
 *   표시로만(`templateImplicit`) 붙는다(세션엔 안 싣는다).
 */
function initReports(students: OneScreenStudent[], templatePrefs: TemplatePrefs = EMPTY_TEMPLATE_PREFS): ReportsState {
  const out: ReportsState = {};
  for (const s of students) {
    out[s.id] = {};
    // 발송상태·공유토큰·ClassNote 상태는 **과목별**(su)로 초기화 — 학생단위(s.reportSent) 뭉갬 금지.
    // 새로고침 시 워커가 쓴 최종 classnoteStatus(success/failed 등)도 roster 초기로드로 반영됨.
    // 멘트/추세 초안도 roster 복원값(오늘 세션 > 오늘 발송본)으로 시딩 — 새로고침 유실 방지.
    for (const su of s.subjects)
      out[s.id]![su.name] = {
        draft: su.draft ?? "",
        trendDraft: su.trendDraft,
        autoDraft: su.autoDraft, // 자동작성 스냅샷(0214a) — 세션 복원값. 저장 시 draft와 비교해 작성 방식 판정.
        trendAutoDraft: su.trendAutoDraft, // 자동작성 추세 스냅샷(2026-10-16) — '달라진 것 없음' 때 칸을 비울지 가른다.
        autoDraftTemplate: su.autoDraftTemplate, // AI 원문 아님(0370a)
        sent: su.reportSent ?? false,
        shareToken: su.shareToken,
        classnoteStatus: su.classnoteStatus,
        revoked: !!su.revokedAt,
        viewCount: su.viewCount,
        attachments: su.attachments ?? [],
        // 영어 템플릿 모드(2026-09-10) — 세션 복원값. 수학 행은 전부 undefined(세션에 키가 없다).
        ...((): { templateId?: string; templateImplicit?: true } => {
          const implicit = implicitTemplateFor(su, templatePrefs);
          return implicit ? { templateId: implicit, templateImplicit: true } : { templateId: su.templateId };
        })(),
        nextTest: su.nextTest,
        aiIntro: su.aiIntro,
        aiComment: su.aiComment,
        templateHash: su.templateHash, // 템플릿 글 지문 — 없으면(옛 세션·가져온 글) 저장 직전 재조립 대상이 아니다
        aiFactsHash: su.aiFactsHash,
        composedFactsHash: su.composedFactsHash,
      };
  }
  return out;
}

/** 이미지 MIME → 저장 경로 확장자(P2b 첨부). 리사이즈로 포맷 보존되니 원본 파일명 ext보다 type이 정확. */
function extFromType(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

/** 보 셀: 과목 전부 발송=ok, 일부 발송/초안=warn, 없음=todo */
function reportCell(map: Record<string, SubjectReport> | undefined, subjectCount: number): CellState {
  if (!map || subjectCount === 0) return "todo";
  const vals = Object.values(map);
  const sent = vals.filter((v) => v.sent).length;
  if (sent >= subjectCount) return "ok";
  if (sent > 0 || vals.some((v) => v.draft.trim())) return "warn";
  return "todo";
}

// ⚠️ 학생 shape로 감싸던 래퍼(`buildExamInfo(student, …)`)는 없앴다 — 점수는 2026-08-13부터 **행 단위**라
//    학생 값을 넘기면 보강·특강 행 추세에 정규 행 점수가 실렸다. 호출부가 rowEval.tests를 직접 넘긴다.

/**
 * 선생님 원스크린 메인 — 상태는 전부 클라이언트 state(새로고침 시 초기화).
 * 데모 충실 이식: DB 영속화/네트워크 없음. 보고서는 **과목별** 템플릿(buildSubjectReport),
 * 발송은 sonner 토스트 목업. 진도(today)는 과목별로 직접 입력.
 */
export function OneScreenClient({
  initial,
  today = TODAY,
  date = "",
  classTags = CLASS_TAGS,
  todayClasses = [],
  allowTeacherTestMax = false,
  showDailyTest = true,
  showCheckTest = true,
  noticeMode: initialNoticeMode = null,
  academyNoticeMode = "A",
  classnoteSendEnabled = false,
  classnoteOn = true,
  sendWindow = null,
  showAttachments = true,
  canEditAttendance = true,
  readonlyView = false,
  presenceScope,
  initialView = "card",
  initialFontSize = DEFAULT_ONESCREEN_FONT_SIZE,
  initialTrendOptOut = [],
  initialTemplatePrefs = EMPTY_TEMPLATE_PREFS,
  initialVideoDueDefault = "week",
  initialDisplayOptions,
  initialClassName = null,
  initialStudentId = null,
  noClassesToday = false,
  showingAll = false,
  holidayName = null,
  teacherName = "",
  reportClassNamePrefix = false,
  teacherEnglishName = null,
  reportSettings,
  academyName = "",
  logoSrc = null,
  canLinkIjw = false,
  classnoteMatch,
}: {
  initial: OneScreenStudent[];
  today?: string;
  date?: string; // 조회 대상 날짜(YYYY-MM-DD) — 저장/발송이 이 날짜로 report_date를 씀(빈값=서버가 오늘으로)
  classTags?: readonly string[];
  todayClasses?: TodayClass[];
  allowTeacherTestMax?: boolean; // 강사가 테스트 문항수(/N) 직접 변경 허용(학원 설정)
  showDailyTest?: boolean; // 일일테스트 사용(보고서 '표시 항목' 설정 재사용) — off면 입력칸 숨김
  showCheckTest?: boolean; // 확인테스트 사용(보고서 '표시 항목' 설정 재사용) — off면 입력칸 숨김
  noticeMode?: "A" | "B" | null; // 강사 본인 멘트 모드 오버라이드(null=학원 기본) — 0104a
  academyNoticeMode?: "A" | "B"; // 학원 기본 멘트 모드(토글 '학원 기본' 라벨)
  classnoteSendEnabled?: boolean; // ClassNote 실제 발송 스위치 — 공지 dry-run 안내
  /** ClassNote 기능(모듈) 켜짐 — 꺼지면 발송 현황·월간 발송·공지·발송 상태 감시를 감춘다(꺼지면 흔적 없이, 2026-09-30). */
  classnoteOn?: boolean;
  /** 그 요일에 담당 수업이 없음 — 목록 대신 안내를 띄운다(폴백 금지, roster.ts 주석). */
  noClassesToday?: boolean;
  /** '담당 반 전체 보기'로 보는 중(요일 무시) — 화면이 그 사실을 밝힌다. */
  showingAll?: boolean;
  /** 그 날짜가 학원설정 휴원일이면 이름(roster.ts) — 안내 띠 + 일괄 출결 확인. 명단·입력은 막지 않는다. */
  holidayName?: string | null;
  sendWindow?: { start: string; end: string } | null; // 발송 허용 시간창 원문(무제한=null) — 창 밖일 때만 안내 배너
  showAttachments?: boolean; // 사진/파일 첨부 표시(학원 설정) — off면 첨부해도 안 실린다는 경고를 카드에 표시
  canEditAttendance?: boolean; // 출결 쓰기 권한 — false면 pill을 표시 전용으로(서버 거절 전에 화면에서 알림)
  /** '다른 강사 뷰'(열람 전용, 2026-08-19) — 전 입력·발송·저장 UI 잠금 + 핸들러 차단(서버 가드의 거울). */
  readonlyView?: boolean;
  presenceScope?: string; // `onescreen:{teacherId}:{date}` — 다른 창/기기 동시 열림 경고(서버가 teacherId 파생)
  initialView?: OneScreenView; // URL(?view=)에서 온 초기 뷰 — 날짜 이동(재마운트) 후에도 보던 뷰 유지
  /** 글씨 크기(내 계정, users.ui_prefs.onescreen.fontSize) — 서버 확정값이라 첫 렌더부터 정확(#75 회피). */
  initialFontSize?: OnescreenFontSize;
  /** '학습 추세 미발송'으로 켠 `반:학생` 키(내 계정 ui_prefs, 원장 2026-09-18) — 글씨 크기와 같은 행에서 온다. */
  initialTrendOptOut?: string[];
  /** 영상 숙제 마감의 내 기본값(7일 · 다음 수업, 내 계정 ui_prefs, 원장 2026-10-28) — 영상 과제를 새로 켠 줄이 이 값으로 시작한다. */
  initialVideoDueDefault?: "week" | "next";
  /** 영어 보고서 템플릿 내 기본값 = 반별 마지막으로 고른 템플릿(내 계정 ui_prefs, 원장 2026-10-27) — 빈 행에만 붙는다. */
  initialTemplatePrefs?: TemplatePrefs;
  initialDisplayOptions?: DisplayOptions;
  /**
   * 진입 시 고를 반 이름(`?class=<반 id>`를 서버가 이름으로 해석해 내림) — '오늘 ECS' 카드에서 넘어올 때
   * 그 반에서 시작한다. null = 전체. ⚠️ **id가 아니라 이름**인 건 반 필터 state가 이름 기반이기 때문
   * (todayClasses·태그·행 판정이 전부 이름 축). 그 날짜에 없는 반이면 서버가 null로 내린다.
   */
  initialClassName?: string | null;
  /** 진입 시 고를 학생(`?student=`) — 그 날짜 로스터에 없으면 서버가 null로 내린다. */
  initialStudentId?: string | null;
  // ── 카드 뷰 우측 '학부모 미리보기' 재료(2026-08-05) — 전부 서버가 확정해 내린다 ──
  // reportSettings가 없으면 미리보기 열이 아예 안 열린다(레이아웃 예전 그대로) → 표시 전용 기능이라 안전한 폴백.
  teacherName?: string;
  reportClassNamePrefix?: boolean;
  /** 영문 이름 — 영어 보고서 미리보기 '담당자' 칸. */
  teacherEnglishName?: string | null;
  reportSettings?: ReportSettings;
  academyName?: string;
  logoSrc?: string | null;
  /**
   * 인재원 짝을 이을 수 있는가(학생 기록 관리 — ijw/server/viewer.ts `getJjAccess`, 페이지가 같은 함수로 내린다).
   * 영어 칸 '인재원 미연결' 줄이 짝 잇기 자리로 가는 링크를 달지(아니면 관리자에게 요청하라고 적는다).
   */
  canLinkIjw?: boolean;
  /** ClassNote 반 보드 매칭(0302a) — 카드·표 모드 이름 옆 'C.N'. 페이지가 fail-soft로 따로 읽어 내린다. */
  classnoteMatch?: CnMatchMap;
}) {
  const router = useRouter();
  // 🔴 화면 문구만 갈린다 — 저장값(태도·과제 '미제출'·보강 행 이름 `과목 (보강)`)은 한국어 그대로다.
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  // 영상 숙제 정책(학원설정) — 저장할 때 '오늘 영상 과제'를 실을 행을 가른다. 공급자 밖이면 null(싣지 않음).
  const videoHwPolicy = useVideoHomeworkPolicy();
  const videoHwSaveOk = useVideoHomeworkSaveOk();
  // 다른 선생님이 처음 쓴 줄 — '영상 과제'를 싣지 않는다(토글도 잠김, report-owner.ts 화면 겹).
  const videoHwByOther = useVideoHomeworkOthersReport();
  const submitLinkMode = useSubmitLinkMode();
  const videoDueReady = useVideoHomeworkDueReady();
  const videoHwStore = useVideoHomeworkStore();
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [noticeMode, setNoticeMode] = useState<"A" | "B" | null>(initialNoticeMode);
  // 글씨 크기 — 화면은 즉시(클릭 반응), 계정 저장은 백그라운드(실패해도 이번 세션 크기는 유지).
  const displaySettings = useDisplayOptionsState(initialDisplayOptions, readonlyView);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // 좁은 카드 뷰의 학부모 미리보기. 폭은 CSS가 가르므로 이 값은 열 배치에 쓰지 않는다.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fontSize, setFontSize] = useState<OnescreenFontSize>(initialFontSize);
  // 영상 숙제 마감의 내 기본값 — 행에서 마감을 고르면 바뀌고 계정에 저장된다(rememberVideoDue).
  const videoDueDefaultRef = useRef<"week" | "next">(initialVideoDueDefault);
  function rememberVideoDue(mode: "week" | "next") {
    if (readonlyView || videoDueDefaultRef.current === mode) return;
    videoDueDefaultRef.current = mode;
    void setMyVideoDueDefault(mode).catch(() => undefined); // 다음 방문용 — 실패해도 지금 화면은 그대로
  }
  const fontZoom = ONESCREEN_FONT_SIZE_ZOOM[fontSize];
  // 보강 학생 중 '이전 진도'를 이미 불러온 학생 id — 버튼 숨김·재요청 방지.
  const [prevLoaded, setPrevLoaded] = useState<Set<string>>(new Set());
  const [makeupPrevBusy, setMakeupPrevBusy] = useState(false); // 보강 학생 이전 진도 일괄 불러오기 중
  const makeupPrevBusyRef = useRef(false); // 토스트 버튼은 옛 렌더의 함수를 들고 있다 — 중복 실행은 ref로 막는다
  // 진입 시 반·학생 지정(2026-08-07) — '오늘 ECS' 카드에서 넘어올 때 그 반(·그 학생)에서 시작한다.
  // ⚠️ 값 검증은 **서버**가 한다(그 날짜 로스터에 실제로 있는 반/학생만 내려온다) — 여기선 그대로 쓴다.
  const [selId, setSelId] = useState<string>(initialStudentId ?? initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>(initialClassName ?? CLASS_TAG_ALL);
  // 작성 상태 필터(전체/작성/미작성) + 그 필터를 누른 시점의 대상 고정 — 입력 중 카드·행이 사라지지 않게.
  // (판정·합집합 규칙은 write-filter.ts. 날짜 이동은 클라 재마운트라 필터도 '전체'로 초기화된다.)
  const [writeFilter, setWriteFilter] = useState<WriteFilter>("all");
  const [writePins, setWritePins] = useState<ReadonlySet<string>>(() => new Set<string>());
  // 대상 날짜(빈값=오늘). 날짜 이동 = searchParam 네비 → 서버가 그 날짜 로스터 재조회 + key로 클라 재초기화.
  const activeDate = date || kstToday();
  const todayYmd = kstToday();
  // 카드 뷰 우측 '학부모 미리보기' 재료 — 렌더마다 새 객체를 만들면 카드가 매번 리렌더되므로 메모.
  // 학원설정(reportSettings)이 안 내려온 경로에선 undefined = 미리보기 열 없음(기존 레이아웃 유지).
  const previewCtx: ReportPreviewContext | undefined = useMemo(
    () =>
      reportSettings
        ? {
            settings: reportSettings,
            academyName,
            logoSrc,
            teacherName,
            reportClassNamePrefix,
            teacherEnglishName,
            reportDate: activeDate,
            showDailyTest,
            showCheckTest,
          }
        : undefined,
    [reportSettings, academyName, logoSrc, teacherName, reportClassNamePrefix, teacherEnglishName, activeDate, showDailyTest, showCheckTest],
  );
  // 반 공통 서술(G6) — 반 이름→서술. sessionStorage(날짜 키)+외부 스토어(#75 lazy 초기값·#25 effect setState 회피).
  // 생성 재료(기록 아님): 자동작성 시 그 행의 반 서술을 classContext로 동봉, 멘트 생성 후엔 잃어도 무해.
  const classNarratives = useSyncExternalStore(
    subscribeClassNarratives,
    () => getClassNarratives(activeDate),
    getServerClassNarratives,
  );
  // 날짜 이동 전 대기 저장 flush — 저장 로직이 아래에 정의되므로 ref로 노출(effect에서 갱신, render 중 ref 쓰기 금지 규칙).
  const flushSavesRef = useRef<() => void>(() => {});
  const goToDate = (ymd: string) => {
    if (makeupSaving) return;
    if (!ymd || ymd > todayYmd || ymd === activeDate) return; // 미래·같은 날짜 무시
    flushSavesRef.current(); // 대기 중(디바운스 800ms) 자동저장을 이동 전 커밋 — 이동=클라 재마운트라 미커밋분 유실 방어
    // ⚠️ 현재 뷰를 쿼리로 들고 이동 — 날짜 이동은 searchParam 네비라 page의 `key={roster.date}`가 클라를 재마운트하고,
    // view가 순수 useState면 표·발송현황에서 날짜만 넘겨도 카드로 튕겼다(원장 지적 07-21). 기본값(card)은 URL에 안 남긴다.
    const params = new URLSearchParams();
    if (ymd !== todayYmd) params.set("date", ymd);
    if (view !== "card") params.set("view", view);
    const qs = params.toString();
    router.push(qs ? `/onescreen?${qs}` : "/onescreen");
  };
  // 카드 ↔ 표 ↔ 발송 현황 ↔ 지난 보고서 ↔ 공지. 초기값은 URL(?view=) — 날짜 이동 후에도 보던 뷰 유지.
  // 토글 자체는 클라 state만 바꾼다(네비 없음) — 뷰 전환마다 서버 왕복하면 체감이 느려진다.
  // 열람 전용은 공지 뷰로 착지하지 않는다(?view=notice 북마크·날짜 내비 URL 잔존 대비) — 공지는 순수 작성 화면.
  const [view, setView] = useState<OneScreenView>(
    (readonlyView && initialView === "notice") || (!classnoteOn && CLASSNOTE_ONLY_VIEWS.has(initialView))
      ? "card"
      : initialView,
  );
  // 공지 컴포저 진입 시 초기 선택 학생(카드=1명, 표=선택/표시). null=진입 안 함.
  const [noticeSeed, setNoticeSeed] = useState<string[] | null>(null);
  // '이전값 일괄 가져오기' 뒤 멘트 확인 대기 계획(null=다이얼로그 닫힘) — 확인해야만 학부모 문구를 채운다.
  const [prevCommentPlan, setPrevCommentPlan] = useState<PrevCommentPlan[] | null>(null);
  /**
   * 보강 추가 시 "정규 보고서에 합칠까 / 따로 낼까" 확인 대기(null=다이얼로그 닫힘).
   * 🔴 합침은 **여기서 확인해야만** 일어난다 — 자동 합치기는 강사가 결과를 예측 못 해 혼란을 낳았다(08-06).
   * `mk`는 '추가'를 누른 시점의 조립 결과(반 필터 앵커 포함)라 그대로 들고 있다가 '분리'에 쓴다.
   */
  const [makeupSaving, setMakeupSaving] = useState(false);
  // 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반' 고르기(A안) — 서버가 메인 수업을 못 정했을 때만 뜬다.
  const [sendClassAsk, setSendClassAsk] = useState<SendClassAsk | null>(null);
  const askSendClass = (ask: Omit<SendClassAsk, "resolve">) =>
    new Promise<string | null>((resolve) => setSendClassAsk({ ...ask, resolve }));
  const [makeupAsk, setMakeupAsk] = useState<{
    studentId: string;
    studentName: string;
    mk: OneScreenStudent;
    candidates: MergeCandidate[];
    sentSubjects: string[];
    /** 목록에 없던 학생(그날 내 정규 수업 없음) — 확인 후에 카드를 만든다. */
    isNew: boolean;
    /** 그 학생의 결석 후보 한 벌(이전 반 포함) — 이월 보강 선택지 + 과목이 달라 뺀 건수. */
    absences: MakeupAbsenceList;
    /** 아직 불러오는 중 — 도착 전에 "결석 기록이 없습니다"라고 단언하지 않게. */
    absencesLoading: boolean;
    /**
     * 보강을 기록할 수업 후보(원장 2026-09-21 *"보강 추가시에 '수업'을 선택할 수 있어야겠어"* → 같은 날 *"항상 다른 수업을
     * 고를 수 있게"*) — 원스크린의 모든 보강 추가가 싣는다(합칠 정규 수업이 있어도). 없으면 창이 묻지 않는다(종전 앵커 그대로).
     */
    hostClasses?: { options: MakeupHostClass[]; loading: boolean; failed?: boolean; noneBlocked?: boolean };
  } | null>(null);
  /**
   * 결석 조회 응답 순서 가드(옆 두 화면 `input-form`·`makeup-add-flow`와 같은 규약).
   * 🔴 **학생 id만으로는 부족하다** — 같은 학생을 반 필터를 바꿔 두 번 열면 조회 결과가 **앵커마다 다르므로**,
   *    늦게 온 옛 조회가 새 창을 덮으면 **다른 과목 목록 + 그 과목 라벨**이 뜬다(과목 필터 이전엔 두 응답이
   *    같아서 안 보이던 레이스다).
   */
  const absenceSeq = useRef(0);
  /** 수업 후보 조회 응답 순서 가드 — 결석 조회와 같은 규약(늦게 온 옛 응답이 새 창을 덮지 않게). */
  const hostSeq = useRef(0);
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial, initialTemplatePrefs));
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(카드 버튼 로딩)
  const [genKey, setGenKey] = useState<string | null>(null); // 표 행별 자동작성 로딩 키(studentId::과목)
  // 영어 템플릿 모드(2026-09-10) — 내 템플릿 목록(맨 앞은 기본). **영어 행이 있을 때만** 한 번 불러온다
  // (첫 페인트 밖 · 수학만 가르치는 강사는 호출 0). 실패해도 기본 템플릿은 그대로 쓴다.
  const [englishTemplates, setEnglishTemplates] = useState<ReportTemplate[]>(() => [...BUILTIN_ENGLISH_TEMPLATES]);
  // 영어 행의 인재원 하루치(2026-09-11) — 카드로 연 행·자동작성·다시 채우기에서만 받는다(use-english-jj.ts).
  const jj = useEnglishJj(activeDate);
  // 다시 채우기가 인재원 자료를 기다리는 동안 또 누르면 '덮을까요?' 확인이 겹쳐 뜬다 — 진행 중인 (학생,과목)을 막는다.
  const refillBusyRef = useRef(new Set<string>());
  // 받는 중에 고른 **다른** 템플릿 — 끝난 뒤 그걸로 한 번 더 채운다(마지막 선택이 이긴다, 적대 재리뷰).
  const refillNextRef = useRef(new Map<string, string>());
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  // 목록을 한 번이라도 받았는가(성공·실패 무관) — 받기 전엔 사용자 템플릿을 "없다"고 단정하지 않는다.
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // 영어 템플릿 내 기본값(반별 마지막 선택) — 고를 때마다 바뀐다. 새로 세우는 행(보강 추가 등)이 지금 값을 쓴다.
  const templatePrefsRef = useRef<TemplatePrefs>(initialTemplatePrefs);
  const [templateListFailed, setTemplateListFailed] = useState(false);
  const hasEnglishRows = useMemo(
    () => students.some((s) => s.subjects.some((su) => su.subjectKey === "english")),
    [students],
  );
  useEffect(() => {
    if (!hasEnglishRows) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listMyReportTemplates();
        if (cancelled) return;
        setEnglishTemplates(res.templates);
        setTemplateNotice(res.notice);
        // 기본값으로 붙여 둔 사용자 템플릿이 목록에 없으면(지움) — 또는 목록이 불완전하면(notice) — 그 빈 행을 코드 기본 템플릿으로
        // 되돌린다. 🔴 안 되돌리면 목록 실패 한 번에 반 전체의 자동작성이 '템플릿 목록 실패'로 멈춘다(적대 리뷰 2026-10-27).
        //    강사가 직접 고른 행은 그대로 둔다(종전대로 알린다).
        const ids = new Set(res.notice ? [] : res.templates.map((tp) => tp.id));
        setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id) && !ids.has(id)));
        // 🔴 안내(notice)가 붙은 목록은 기본 템플릿뿐인 **불완전한** 목록이다(DB 오류·표 없음·권한) — 실패로 친다.
        //    안 치면 사용자 템플릿 행에 '삭제됨' 거짓 칩이 서고, 자동작성이 기본 템플릿으로 바꿔 끼워 선택을 잃었다(적대 재리뷰).
        if (res.notice) setTemplateListFailed(true);
      } catch {
        // 목록을 못 받아도 기본 템플릿으로 계속 쓸 수 있다 — 화면을 막지 않되 **알린다**
        // (말없이 기본으로 바꿔 끼우면 고른 템플릿과 다른 글이 나간다).
        if (!cancelled) {
          setTemplateListFailed(true);
          // 기본값으로만 붙여 둔 사용자 템플릿은 되돌린다(위와 같은 이유) — 강사가 고른 행은 그대로.
          setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id)));
        }
      } finally {
        if (!cancelled) setTemplatesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasEnglishRows]);
  const [bulkGen, setBulkGen] = useState(false); // 표 일괄 자동작성 진행중
  const [bulkBusy, setBulkBusy] = useState<"save" | "send" | null>(null); // 일괄 저장/발송 진행중 — 재진입·행발송 잠금(#9/#10)

  // '다른 강사 뷰'(열람 전용) — 클라 1차 차단. 버튼·입력도 잠그지만(locked·canSend·canQueue) 핸들러 입구를
  // 한 번 더 끊어 드래그·단축키·일괄 같은 우회가 안 남게 한다. 진짜 게이트는 서버(#77 — perm-matrix 캡 +
  // readonlyTeacherViewError)고 이건 그 거울이다. 원장 제보(2026-08-19): 토스트 경고만으론 무시된다.
  // 문구는 서버 거절과 같은 단일 소스(view-as-message.ts) — 두 벌이면 한쪽만 고쳐진다.
  function readonlyBlocked(): boolean {
    if (!readonlyView) return false;
    toast.error(READONLY_TEACHER_VIEW_ERROR);
    return true;
  }
  const [attUrls, setAttUrls] = useState<Record<string, string>>({}); // 첨부 path→signed 썸네일 URL(P2b)
  const [attPending, setAttPending] = useState<Set<string>>(new Set()); // 출결 저장 중 (학생::반) — pill 잠금(2-2)
  const [quickAttBusy, setQuickAttBusy] = useState(false); // 학생 목록 머리 '일괄 출석' 왕복 중 — 연타 방지
  // 첨부 업로드 중인 (학생::과목) 키 — 표는 행마다 첨부할 수 있어 과목명만으론 어느 행인지 못 가린다.
  const [uploadingAttKey, setUploadingAttKey] = useState<string | null>(null);
  const openPrint = usePrintWindow(); // "PDF" = 저장된 보고서를 인쇄 문서 플로팅 창으로 연다
  // 다른 창/기기 동시 열림 경고(3-3, 락 아님) — enabled=페이지 열림. 같은 계정 다른 탭/기기도 잡힌다(presence key 기준).
  useEditPresence(presenceScope, true);
  const sameDateEditors = dedupeEditors(useEditingOthers(presenceScope ?? ""));

  // 자동저장(디바운스) — 최신 state를 타이머 콜백에서 읽기 위한 ref 미러 + 학생별 타이머.
  const studentsRef = useRef(students);
  const reportsRef = useRef(reports);
  /**
   * '학습 추세 미발송'(원장 2026-09-18) — `반:학생` 키. 🔴 저장 조립은 비동기 경로(디바운스·발송)에서도 불리므로
   *    **ref로도** 들고 있는다 — 체크 직후 나간 저장이 옛 closure를 읽으면 끈 추세가 실린다.
   */
  const [trendOptOut, setTrendOptOut] = useState<ReadonlySet<string>>(() => new Set(initialTrendOptOut));
  const trendOptOutRef = useRef(trendOptOut);
  // 영어 템플릿 목록·로딩 여부 미러 — 일괄 자동작성(비동기 루프) 중 목록이 도착해도 다음 행부터 본다.
  const englishTemplatesRef = useRef(englishTemplates);
  const templatesLoadedRef = useRef(templatesLoaded);
  const templateListFailedRef = useRef(templateListFailed);
  // 출결 in-flight 미러 — 상단 스트립 방송이 **내가 방금 누른 알약**을 되돌리지 않게(응답 역전 방지).
  const attPendingRef = useRef(attPending);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs). 타이머는 800ms 뒤라 항상 최신 반영.
  useEffect(() => {
    studentsRef.current = students;
    reportsRef.current = reports;
    attPendingRef.current = attPending;
    englishTemplatesRef.current = englishTemplates;
    templatesLoadedRef.current = templatesLoaded;
    templateListFailedRef.current = templateListFailed;
    trendOptOutRef.current = trendOptOut;
  });
  /**
   * 상단 '오늘 출석 미입력' 스트립이 기록한 칸을 이 화면에 반영한다(원장 제보 2026-08-20 —
   * *"상단에서 출석하면 수업보고서에 연동이 안되는것 같은데"*).
   *
   * 🔑 로스터는 마운트 1회만 복사되고 스트립의 `router.refresh()`는 클라 state를 보존한다 → 새 `initial`
   *    prop이 무시된다. props 병합으로 고치면 디바운스 세션 저장이 되돌린 RSC payload가 방금 찍은 알약을
   *    덮을 수 있어(#102), **서버가 실제로 기록한 칸만** 싣는 방송으로 좁힌다.
   * ⚠️ 날짜가 다르면 무시한다 — 과거 날짜를 열어 둔 화면에 오늘 기록이 새면 안 된다.
   * ⚠️ setState는 **이벤트 콜백 안에서만**(effect 본문 setState 금지, #25).
   * ⚠️ 교시(`detail.slot`)는 안 본다 — 원스크린 출결 행은 (학생×반) 축이고, 새로고침 뒤 로스터도
   *    그 칸의 **가장 최근 기록**을 집으므로 방금 쓴 값이 그대로 진실이다.
   * ⚠️ `patch`가 아니라 `setStudents` — **queueSave를 부르지 않는다**(ClassNote 배지 반영과 같은 규약):
   *    내 편집이 아니라 서버가 알려준 사실이고, 출결은 세션 행(onescreen_daily_sessions)에 안 들어간다.
   */
  useEffect(
    () =>
      subscribeAttendanceApplied((detail) => {
        if (detail.date !== activeDate) return;
        setStudents((prev) =>
          applyAppliedAttendance(prev, detail.cells, detail.status, attPendingRef.current),
        );
      }),
    [activeDate],
  );
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 덜 쓴 창 저장을 서버가 건너뛴 학생 — 800ms 자동저장마다 토스트가 쌓이지 않게 1회만.
  const skippedSaveToast = useRef<Set<string>>(new Set());
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);
  // 대기 중 자동저장을 즉시 커밋(날짜 이동 전 호출) — 디바운스 800ms 안에 이동하면 유실되던 편집 방어.
  useEffect(() => {
    flushSavesRef.current = () => {
      for (const [sid, timer] of saveTimers.current) {
        clearTimeout(timer);
        const s = studentsRef.current.find((x) => x.id === sid);
        if (!s) continue;
        void saveOnescreenSession(buildSessionInput(s, reportsRef.current[sid])).then((res) => {
          applySessionSaveResult(sid, res);
        });
      }
      saveTimers.current.clear();
    };
  });
  function applySessionSaveResult(
    studentId: string,
    res: { ok: boolean; error?: string; skipped?: boolean; updatedAt?: string },
  ) {
    if (!res.ok) {
      // 서버가 준 사유가 있으면 그대로(그 문장은 서버 축이라 한국어) — 없을 때만 화면 사전.
      toast.error(res.error ?? t("os.c.autosaveFail"));
      return;
    }
    if (res.skipped) {
      if (!skippedSaveToast.current.has(studentId)) {
        skippedSaveToast.current.add(studentId);
        toast.message(t("os.c.saveIgnored"));
      }
      return;
    }
    if (!res.updatedAt) return;
    skippedSaveToast.current.delete(studentId);
    studentsRef.current = studentsRef.current.map((s) =>
      s.id === studentId ? { ...s, sessionUpdatedAt: res.updatedAt } : s,
    );
    setStudents((prev) => prev.map((s) => (s.id === studentId ? { ...s, sessionUpdatedAt: res.updatedAt } : s)));
  }
  function buildSessionInput(s: OneScreenStudent, r: Record<string, SubjectReport> | undefined) {
    return {
      studentId: s.id,
      outOfClass: s.isMakeup === true,
      sessionDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — 과거 날짜 작업분도 그 날짜 세션에 저장
      classId: s.classId ?? null,
      baseUpdatedAt: s.sessionUpdatedAt ?? null,
      studyGrade: s.studyGrade ?? null,
      subjectProgress: Object.fromEntries(
        s.subjects
          // 🔴 보강 행도 **이제는 저장한다**(2026-08-13). 예전엔 통째로 걸러냈는데(2026-07-24), 그래서
          //    보강 행에 쓴 진도·교재·오늘 과제가 **새로고침 한 번에 사라졌다**(원장 제보 2026-08-13
          //    "입력해놓은 내용이 일부 새로고침시에 삭제"). 저장된 보고서에서도 복원되지 않는 값들이라
          //    되찾을 길이 없었다.
          //    걸러냈던 진짜 이유는 키 충돌이었다 — 과목키('math')로 저장하면 정규 행이 미편집일 때
          //    로스터의 legacyKey 폴백이 그 항목을 집어 **보강 진도가 정규 행에 새어들었다**(교차오염).
          //    → 보강 행은 `makeup::{과목키}` **전용 키**를 쓴다. legacyKey 폴백은 맨 키('math')만 보므로
          //      구조적으로 겹치지 않는다(로스터가 같은 규약으로 읽는다).
          .map((su) => [
            // 반 키 우선(0134a) — 과목키면 같은 과목 두 행(정규+특강)이 한 항목을 공유해 서로를 덮는다.
            // 로스터 복원(roster.ts)이 같은 순서로 읽는다(보강 전용 키 → 반 키 → 과목키 폴백).
            su.makeup && !su.classId
              ? `makeup::${su.subjectKey || su.name}`
              : su.classId || su.subjectKey || su.name,
            {
              today: su.today,
              // 오늘 수업 성격(복습·문제풀이) — 빈 문자열로 보내 **해제도 저장**한다(undefined면 로스터가
              // `!= null` 복원에서 건너뛰어 껐던 상태가 새로고침에 되살아난다).
              mode: su.progressMode ?? "",
              draft: r?.[su.name]?.draft ?? "",
              trendDraft: r?.[su.name]?.trendDraft ?? "",
              // 자동작성 스냅샷(0214a) — 초안과 함께 영속해야 재접속 후 저장이 manual로 오표기되지 않는다.
              autoDraft: r?.[su.name]?.autoDraft ?? "",
              // 추세 스냅샷·AI 원문 아님 표시도 같은 규약(새로고침 뒤에도 낡은 AI 추세를 지우고, 템플릿·복사 글을 원문으로 싣지 않게).
              ...(r?.[su.name]?.trendAutoDraft ? { trendAutoDraft: r[su.name]!.trendAutoDraft } : {}),
              ...(r?.[su.name]?.autoDraftTemplate ? { autoDraftTemplate: true } : {}),
              textbook: su.textbook ?? "",
              makeup: su.makeup ?? false,
              homeworkToday: su.homeworkToday ?? "",
              // 오늘 영상 과제 있음(0308a) — 켠 적 없는 행은 빼서 세션 모양을 그대로 둔다.
              ...(su.videoHomework != null ? { videoHomework: su.videoHomework } : {}),
              // 영상 첨부 링크 넣기(0328a) — 고른 적 없는 행은 빼서 세션 모양을 그대로 둔다.
              ...(su.videoSubmitLink != null ? { videoSubmitLink: su.videoSubmitLink } : {}),
              // 영상 숙제 마감(원장 2026-10-15) — 고른 적 없는 행은 빼서 세션 모양을 그대로 둔다(날짜는 서버가 정해 세션에 안 싣는다).
              ...(su.videoHomeworkDue != null ? { videoHomeworkDue: su.videoHomeworkDue } : {}),
              // 영어 템플릿 모드(2026-09-10) — **영어 행만** 싣는다(수학 세션 모양 불변). 로스터가 같은 키로 복원한다.
              ...(su.subjectKey === "english"
                ? {
                    // 기본값으로만 붙인 템플릿은 싣지 않는다 — 실으면 기본값을 바꿔도 이 행이 옛 기본값에 묶인다(last-template.ts).
                    //   단 글이 있는 행은 싣는다 — patchReport를 거치지 않고 글이 생긴 행도 그 템플릿으로 쓴 글이다.
                    templateId:
                      r?.[su.name]?.templateImplicit && !(r?.[su.name]?.draft ?? "").trim() ? "" : (r?.[su.name]?.templateId ?? ""),
                    nextTest: r?.[su.name]?.nextTest ?? "",
                    aiIntro: r?.[su.name]?.aiIntro ?? "",
                    aiComment: r?.[su.name]?.aiComment ?? "",
                    // 지문 둘(english-draft.ts) — 새로고침 뒤에도 "템플릿 글 그대로인가"·"AI가 옛 값 기준인가"를 판정한다.
                    templateHash: r?.[su.name]?.templateHash ?? "",
                    aiFactsHash: r?.[su.name]?.aiFactsHash ?? "",
                    composedFactsHash: r?.[su.name]?.composedFactsHash ?? "",
                  }
                : {}),
              // 행 단위 평가값(태도·점수·과제 수행률·특이사항) — 지정된 행만 싣는다(row-fields.ts).
              // 미지정 행은 옛 세션과 같은 모양으로 남아 로스터가 학생 값으로 폴백한다(하위호환).
              // 소단원별 이해도(수학 보고서 시범) — 쓴 행만 싣는다(나머지 세션 모양 불변).
              ...(su.understanding ? { understanding: su.understanding } : {}),
              // 일일 테스트 '없음' 사유(수학 보고서 시범) — 고른 적 있는 행만(null = 다시 '있음'으로 돌린 것).
              ...(su.dailyTestSkip !== undefined ? { dailyTestSkip: su.dailyTestSkip } : {}),
              // 숙제 미제출 사유(수학 보고서 시범) — 적은 적 있는 행만.
              ...(su.homeworkMissReason !== undefined ? { homeworkMissReason: su.homeworkMissReason } : {}),
              // 수업 태도 의견 · 보강 사유(2026-10-26) — 적은 적 있는 행만.
              ...(su.attitudeNote !== undefined ? { attitudeNote: su.attitudeNote } : {}),
              // '오늘의 수업' 메모(2026-10-28) — 적은 적 있는 행만.
              ...(su.lessonMemo !== undefined ? { lessonMemo: su.lessonMemo } : {}),
              ...(su.makeupReason !== undefined ? { makeupReason: su.makeupReason } : {}),
              ...(hasRowOverrides(su)
                ? {
                    attitude: su.attitude,
                    homework: su.homework,
                    note: su.note,
                    dailyScore: su.dailyScore,
                    dailyMax: su.dailyMax,
                    checkScore: su.checkScore,
                    checkMax: su.checkMax,
                  }
                : {}),
            },
          ]),
      ),
      // 비활성 테스트는 세션에도 점수를 재기입하지 않는다(off 후 남은 옛 점수를 다음 저장이 되살리지 않도록 self-heal).
      dailyScore: showDailyTest ? s.tests.daily.score : null,
      dailyMax: s.tests.daily.max,
      checkScore: showCheckTest ? s.tests.check.score : null,
      checkMax: s.tests.check.max,
      attitude: s.attitude,
      homework: s.homework || null,
      note: s.note || null,
      progressConfirmed: s.progressConfirmed,
    };
  }
  // 학생별 디바운스 upsert — 편집 800ms 후 저장. 학생별 타이머라 학생 전환에도 유실 없음.
  function queueSave(studentId: string) {
    const prev = saveTimers.current.get(studentId);
    if (prev) clearTimeout(prev);
    saveTimers.current.set(
      studentId,
      setTimeout(() => {
        saveTimers.current.delete(studentId);
        const s = studentsRef.current.find((x) => x.id === studentId);
        if (!s) return;
        void saveOnescreenSession(buildSessionInput(s, reportsRef.current[studentId])).then((res) => {
          applySessionSaveResult(studentId, res);
        });
      }, 800),
    );
  }

  // 반 필터 — 특정 반이면 그 반 수강생 전부(tags로 다과목/다반 학생도 양쪽에서 잡음, 누락 방지) + 좌측 그룹 라벨을
  // 필터 반으로 리맵. 표 행은 activeClassFilter로 rowInClass 필터해 타 반 과목 행 혼입을 막는다.
  const activeClassFilter = classFilter === CLASS_TAG_ALL ? null : classFilter;
  // ⚠️ 보강(수업외)은 반 무관이라 필터를 통과시킨다(studentInClass) — 안 그러면 특정 반을 고른 채 추가한
  //    보강 학생이 카드째 사라진다(2026-07-27 강사 제보). 라벨 리맵은 **그 반 실제 수강생에게만**:
  //    보강 카드까지 리맵하면 듣지도 않는 반 이름이 카드에 박힌다.
  const classVisible =
    activeClassFilter == null
      ? students
      : students
          .filter((s) => studentInClass(s, activeClassFilter))
          .map((s) =>
            isClassMember(s, activeClassFilter)
              ? { ...s, className: activeClassFilter, tag: activeClassFilter }
              : s,
          );

  // ── 작성 상태 필터(전체/작성/미작성) — 판정은 순수함수(write-filter.ts), 여기선 재료 조립만 ──
  // ⚠️ 반 필터가 걸려 있으면 **그 반 행만** 보고 판정한다. 안 그러면 화면에 보이지도 않는 다른 반 행 때문에
  //    "보이는 행은 다 썼는데 미작성으로 남는" 유령이 생긴다(표 행은 이미 rowInClass로 좁혀져 있다).
  const writtenById: Record<string, boolean> = {};
  for (const s of classVisible) {
    writtenById[s.id] = isStudentWritten(
      s.subjects
        .filter((su) => rowInClass(su, activeClassFilter))
        .map((su) => ({
          draft: reports[s.id]?.[su.name]?.draft,
          sent: reports[s.id]?.[su.name]?.sent,
          attendanceRaw: su.attendanceRaw,
          reportOptout: su.reportOptout,
        })),
    );
  }
  // 🔴 필터는 `visible` 자체를 좁힌다 — 표시 목록과 **일괄 저장·발송·자동작성 대상이 반드시 같은 집합**이어야
  //    한다(일괄 액션은 전부 visible에서 행을 만든다). 표시만 따로 좁히면 "화면엔 12명인데 일괄 발송은 28명"이 된다.
  const visible = applyWriteFilter(classVisible, writeFilter, writtenById, writePins);
  /**
   * 머리의 '일괄 출석'(빠른 출결) 재료 — **표 모드·카드 모드가 이 한 번의 계산을 나눠 쓴다**(두 화면이
   * 다른 수를 말하면 안 된다). 대상은 표시 집합(`visible`) × 반 필터라 라벨의 숫자와 실제로 보내는
   * 칸이 같다. 출결 쓰기 권한이 없으면 아예 안 내려보내 버튼 자체가 사라진다(누를 수 있는 척 금지).
   */
  const quickPresent = planQuickPresent(visible, activeClassFilter);
  const bulkPresentProps = canEditAttendance
    ? {
        count: quickPresent.cells.length,
        alreadyMarked: quickPresent.alreadyMarked,
        busy: quickAttBusy,
        onApply: applyQuickPresent,
      }
    : undefined;
  const writeCounts = {
    written: countByWriteFilter(classVisible, "written", writtenById),
    unwritten: countByWriteFilter(classVisible, "unwritten", writtenById),
  };
  // 필터로 목록이 비었을 때의 문구 — 기본 문구("해당 반 학생이 없습니다")는 반 탓을 하는 거짓말이 된다.
  const emptyByWriteFilter =
    writeFilter === "all"
      ? undefined
      : writeFilter === "unwritten"
        ? t("os.c.emptyUnwritten")
        : t("os.c.emptyWritten");
  // 고정(pinned) 덕에 조건과 어긋난 채 남아 있는 학생 수 — 안내줄이 그 사실을 밝히고 '목록 정리'를 준다.
  const staleCount =
    writeFilter === "all"
      ? 0
      : visible.filter((s) => !matchesWriteFilter(writeFilter, writtenById[s.id] === true)).length;
  // 필터를 누른 **그 시점의 대상**을 고정 — 이후 입력으로 상태가 바뀌어도 카드·행이 눈앞에서 사라지지 않는다.
  // 같은 버튼을 다시 누르면 여기서 재계산돼 목록이 정리된다(= 안내줄의 '목록 정리'와 동일 경로).
  function changeWriteFilter(next: WriteFilter) {
    setWriteFilter(next);
    setWritePins(
      next === "all"
        ? new Set<string>()
        : new Set(
            classVisible
              .filter((s) => matchesWriteFilter(next, writtenById[s.id] === true))
              .map((s) => s.id),
          ),
    );
  }
  // 순서변경(3-2)은 단일 반 필터에서만 — 저장 키가 (강사×반)이라 "전체"에선 반이 특정되지 않는다.
  // ⚠️ 동명 반(과목만 다른 같은 이름, 스키마 허용) 가드: 필터는 이름 기반이라 두 반 학생이 섞여 보이는데
  //    첫 반 id로 저장하면 남의 반 학생이 섞인다(리뷰 확정) → 이름 매칭이 유일할 때만 순서 기능 노출.
  const matchingClasses =
    classFilter !== CLASS_TAG_ALL ? todayClasses.filter((c) => c.name === classFilter) : [];
  const orderClass = matchingClasses.length === 1 ? matchingClasses[0] : undefined;
  const effectiveId = visible.some((s) => s.id === selId) ? selId : (visible[0]?.id ?? "");
  const selected = visible.find((s) => s.id === effectiveId) ?? null;

  // ── 카드 뷰 학부모 미리보기 ──────────────────────────────────────────────
  // 과목 칩 선택을 **여기서** 들고 있다 — 미리보기가 옆 열(형제)이라 카드 안 state로는 알 수 없다.
  // 학생이 바뀌면 자동으로 0번으로 돌아간다(학생 id를 함께 저장해 불일치면 0으로 읽는다 → 리셋 effect 불필요).
  const [cardSubject, setCardSubject] = useState<{ id: string; idx: number }>({ id: "", idx: 0 });
  const subjectIdx =
    selected && cardSubject.id === selected.id
      ? Math.min(cardSubject.idx, Math.max(0, selected.subjects.length - 1))
      : 0;
  const previewSubject = selected?.subjects[subjectIdx];
  const previewReport = selected && previewSubject ? reports[selected.id]?.[previewSubject.name] : undefined;
  // 영어 행을 카드로 열면 그날 인재원 하루치를 받는다 — **연 행만**(첫 화면에서 전원을 부르지 않는다). 받은 뒤엔 캐시.
  const jjOpenId = selected && previewSubject?.subjectKey === "english" ? selected.id : "";
  const jjOpenOut = !!selected && rowOutOfClass(selected, previewSubject);
  const jjEnsure = jj.ensure;
  useEffect(() => {
    if (jjOpenId) void jjEnsure(jjOpenId, { outOfClass: jjOpenOut });
  }, [jjOpenId, jjOpenOut, jjEnsure]);
  // 학습 추이 이력 — 선택된 (학생, 과목) 1건만 **지연 조회**(첫 페인트 비용 0, actions.loadReportTrend 주석).
  // ⚠️ effect 본문에서 setState 금지(#25) → 요청 중복은 **ref**로 막고, state는 응답 콜백에서만 쓴다.
  //    "지금 보는 대상의 결과인지"는 렌더 중 키 비교로 판정한다(옛 학생 그래프가 새 학생에 남지 않게).
  const wantTrendKey =
    previewCtx && selected && previewSubject
      ? `${selected.id}::${previewSubject.subjectKey ?? previewSubject.subjectLabel ?? previewSubject.name}::${previewSubject.classId ?? ""}::${activeDate}`
      : "";
  const trendReqRef = useRef("");
  const [trend, setTrend] = useState<{ key: string; rows: TrendReportRow[] } | null>(null);
  useEffect(() => {
    if (!wantTrendKey || trendReqRef.current === wantTrendKey) return;
    trendReqRef.current = wantTrendKey;
    const [sid, subj, cid] = wantTrendKey.split("::");
    let alive = true;
    void loadReportTrend(sid!, subj || null, cid || null, activeDate).then((res) => {
      if (alive && res.ok) setTrend({ key: wantTrendKey, rows: res.rows ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [wantTrendKey, activeDate]);
  const trendRows = trend?.key === wantTrendKey ? trend.rows : undefined;

  // 보고서 셀(과목별 발송 반영) + "오늘 마감" 카운트.
  // 테스트 사용 여부(showDailyTest/showCheckTest)를 넘겨 비활성 테스트가 마감 카운트를 0에 고정하지 않게(#25).
  const testCfg = { dailyEnabled: showDailyTest, checkEnabled: showCheckTest };
  const reportCellById: Record<string, CellState> = {};
  // ⚠️ 분모에서 '수업보고서 미발송' 반 행은 뺀다(2026-08-19) — 안 빼면 정규 반 보고서를 다 써도
  //    그 학생 '보고서' 칸이 영영 ok가 안 된다(그 반 행은 저장 자체가 잠겨 있다).
  for (const s of students)
    reportCellById[s.id] = reportCell(
      reports[s.id],
      s.subjects.filter((su) => !isReportOptoutRow(su)).length,
    );
  // 이름 옆 발송 표시(원장 2026-07-27: "발송완료면 체크 같은 걸 이름 옆에" — 지금은 라벨 불 들어온 걸로만 구분).
  // 기준은 **학부모에게 실제로 나간 행**(ClassNote 발송 완료) — '저장됨'과 다르다(저장만으론 안 나간다).
  // ⚠️ ClassNote 발송이 꺼진 학원은 게시가 아예 없어 표시가 영원히 안 뜬다 → 그땐 '보고서 저장' 기준으로
  //    폴백하되, 툴팁 라벨로 어느 기준인지 밝힌다(같은 아이콘이 말없이 다른 뜻이 되지 않게).
  // ⚠️ 분모에서 결석 행은 뺀다 — 발송이 원천 차단된 행이라 남기면 "1/2"가 영영 안 채워진다(#77과 같은 이유).
  //    '수업보고서 미발송' 반(0174a) 행도 같은 이유로 뺀다(2026-08-19) — 그 반은 발송이 **영구히** 없어서
  //    남기면 그 학생 표시가 영원히 안 채워진다.
  const sendMarkLabel = classnoteSendEnabled ? t("os.c.markSend") : t("os.c.markSave");
  // 이 날짜에 **이미 학부모에게 나간** 행 수 — 상단 안내 + "왜 수정/발송이 막혔나"의 근거.
  // ⚠️ 화면 state(reports)를 본다: 로스터 스냅샷만 보면 세션 중 방금 보낸 건이 안 세어진다.
  const sentRowCount = visible.reduce(
    (n, s) =>
      n +
      s.subjects.filter((su) => isAlreadySent(effectiveClassnoteStatus(reports[s.id]?.[su.name]?.classnoteStatus, su.classnoteStatus)))
        .length,
    0,
  );

  function patch(id: string, fn: (s: OneScreenStudent) => OneScreenStudent) {
    setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
    queueSave(id); // 편집 → 디바운스 서버 영속(onescreen_daily_sessions)
  }
  // 워커가 백그라운드로 끝낸 ClassNote 발송 결과를 배지에 반영 — 새로고침 없이 '발송 대기' → '발송 완료'.
  // ⚠️ **queueSave를 부르지 않는다**: 내 편집이 아니라 서버가 알려준 사실이라 세션을 다시 쓸 이유가 없다.
  // 병합 규칙(빈 상태 무시·화면에 없는 과목 무시)은 순수함수 mergeClassnoteStatuses 한 곳에.
  function applyClassnoteStatuses(rows: ClassnoteStatusRow[]) {
    setReports((prev) =>
      mergeClassnoteStatuses(prev, rows, (studentId, subjectKey, classId) => {
        const subjects = studentsRef.current.find((s) => s.id === studentId)?.subjects;
        if (!subjects) return undefined;
        // 반 정확매칭 우선(0134a) — 같은 과목 두 행은 과목키가 같아 폴백만으론 엉뚱한 행에 배지가 붙는다.
        if (classId) {
          const byClass = subjects.find((su) => su.classId === classId);
          if (byClass) return byClass.name;
          // 화면에 없는 반(다른 강사·다른 요일)의 보고서 → 어느 행에도 붙이지 않는다.
          return undefined;
        }
        // 반 없는 보고서(관리자 작성·구버전)는 과목으로. 같은 과목 두 행이면 **앞 행**(로스터 정렬 순).
        return subjects.find((su) => (su.subjectKey || su.subjectLabel || su.name) === subjectKey)?.name;
      }),
    );
  }
  // 대기·처리중인 학생이 있는 동안만 감시(없으면 조회 0회, 다 끝나면 저절로 멈춘다).
  const pendingSends = useMemo(() => pendingSendStudentIds(reports), [reports]);
  useClassnoteStatusSync(date, classnoteOn ? pendingSends : NO_PENDING, applyClassnoteStatuses);
  // C.N 아이콘(반 보드 매칭) — 새로고침 없이 갱신(원장 2026-11-04 · use-live-classnote-match.ts). 반 = 이 날짜 로스터의 반(페이지가 좁힌 것과 같다).
  const cnClassIds = useMemo(() => initial.flatMap((s) => s.subjects.flatMap((su) => (su.classId ? [su.classId] : []))), [initial]);
  const { map: liveClassnoteMatch, boost: boostClassnoteMatch } = useLiveClassnoteMatch(classnoteMatch, {
    enabled: classnoteOn,
    date: activeDate,
    classIds: cnClassIds,
  });

  function patchReport(
    studentId: string,
    subjectName: string,
    fn: (r: SubjectReport) => SubjectReport,
  ) {
    setReports((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        // 기본값으로 붙은 템플릿은 글이 생기는 순간 굳힌다(last-template.ts settleImplicit — 어떤 경로로 글이 생겨도).
        [subjectName]: settleImplicit(fn(prev[studentId]?.[subjectName] ?? { draft: "", sent: false })),
      },
    }));
    queueSave(studentId);
  }

  function confirmProgress() {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, progressConfirmed: !s.progressConfirmed }));
  }
  // 작성 시간 기록(원장 2026-10-28, write-timing.ts) — 칸 세터마다 한 줄. 표 안에서 연 카드 상세는 '카드'로 센다(카드 화면을 쓰는 것이다).
  function writeView(): WriteView {
    return view === "grid" && !detailsOpen ? "grid" : "card";
  }
  function wt(studentId: string, subjectName: string, field: WriteField) {
    if (!readonlyView) markWrite(activeDate, studentId, subjectName, field, writeView());
  }
  function wtIdx(studentId: string, subjectIndex: number, field: WriteField) {
    const name = studentsRef.current.find((x) => x.id === studentId)?.subjects[subjectIndex]?.name;
    if (name) wt(studentId, name, field);
  }
  // ── studentId 파라미터 핸들러(표=행별 직접 호출, 카드=selected wrapper) — 로직 단일 소스 ──
  function setProgressFor(studentId: string, subjectIndex: number, today: string) {
    wtIdx(studentId, subjectIndex, "progress");
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su, i) => (i === subjectIndex ? { ...su, today } : su)),
    }));
  }
  /** 오늘 수업 성격(복습·문제풀이) 토글 — 진도와 **함께** 사는 축이라 진도 값은 건드리지 않는다. */
  function setProgressModeFor(studentId: string, subjectIndex: number, mode: string | null) {
    wtIdx(studentId, subjectIndex, "progress");
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su, i) => (i === subjectIndex ? { ...su, progressMode: mode } : su)),
    }));
  }
  function setStudyGradeFor(studentId: string, grade: string) {
    // 진도 학년 변경(선행/현행) — **고른 차시는 지우지 않는다**(원장 2026-08-07: *"진도를 여러 학년에
    // 걸쳐 선택하는건 불가능한가? 내신대비 기간이라 한시간은 선행, 한시간은 현행 하고 싶을 수도 있으니까"*).
    // 예전엔 학년을 바꾸는 순간 math 과목의 `today`를 통째로 비웠다 → 두 학년을 섞는 것이 **구조적으로 불가능**했고,
    // 학년만 확인하려고 드롭다운을 건드려도 고른 차시가 통째로 날아갔다.
    // ⚠️ 차시 이름은 커리큘럼 전체에서 유일하므로(curriculum.ts 주석) 두 학년 차시가 한 값에 섞여도
    //    위치 매핑(positionOf)이 흔들리지 않는다. 선택기는 다른 학년 선택분을 '다른 학년 N차시'로 보여준다.
    patch(studentId, (s) => ({ ...s, studyGrade: grade }));
  }
  // 강사 본인 AI 멘트 모드(단일 A / 2문단 B / 학원 기본 null) 저장 — 낙관적 반영 + 실패 롤백.
  async function changeNoticeMode(mode: "A" | "B" | null) {
    const prev = noticeMode;
    setNoticeMode(mode);
    const res = await setMyNoticeMode(mode);
    if (!res.ok) {
      setNoticeMode(prev);
      toast.error(res.error ?? t("os.c.mentModeFail"));
    } else {
      toast.success(
        mode === null
          ? t("os.c.mentModeAcademy")
          : tf("os.c.mentModeSet", {
              mode: mode === "A" ? t("os.c.mentModeA") : t("os.c.mentModeB"),
            }),
      );
    }
  }
  /**
   * 글씨 크기 변경 — 화면은 **즉시** 바꾸고 계정 저장은 뒤따른다(반응속도 1순위).
   * ⚠️ 저장에 실패해도 되돌리지 않는다 — 지금 보고 있는 크기를 강사 의사와 반대로 되돌리는 게 더 나쁘다.
   *    다음 방문에 옛 크기로 돌아온다는 사실만 알린다(토스트는 실패했을 때만 — 크기 변화는 눈에 보인다).
   */
  async function changeFontSize(size: OnescreenFontSize) {
    if (size === fontSize) return;
    setFontSize(size);
    const res = await setMyOnescreenFontSize(size);
    if (!res.ok) toast.error(t("os.c.fontSizeFail"));
  }
  /**
   * 🔴 보강 칸은 **서버가 앵커 반에** 적는다(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 확인하는 순간 등록 문(`registerMakeupEntries`,
   *    `recordCell`)이, 보고서를 저장할 때 저장 훅(`saveLessonReport`)이 **같은 함수**(`syncAnchorCells`)로 기다려서 적는다(이미 있으면 그대로).
   *    예전엔 확인창이 여기서 칸을 **기다리지 않고** 먼저 적었고(`persistAnchorMakeup`), 실패하면 저장 훅이 다른 반(예약 반·보강 반)에
   *    칸을 세워 보고서 반과 출석부 반이 갈렸다(C2). 확인 때 적어 두는 이유 = 보고서를 안 쓰는 보강(영어 등)·저장 실패에도 시수가 남게.
   */
  // 보강(수업외) 학생 추가 — 서버에서 OneScreenStudent 조립(담당 과목·교재 기본값).
  //
  // ⚠️ 정규/특강으로 **이미 목록에 있는 학생**도 보강 추가가 돼야 한다(2026-07-24 원장: 특강+정규외 보강).
  //    별도 카드(가짜 id)는 카드 id가 곳곳에서 DB 학생 id로 쓰여 첨부·발송상태를 깨뜨린다(적대검수 실측) →
  //    대신 **그 학생 카드에 '수학 (보강)' 행을 병합**한다(카드 id=실제 학생 id 불변 = 안전). 보강 행은
  //    classId=null·makeup=true라 DB에서 정규 보고서와 별개(unit_key 분리)로 저장되고, 학부모 보고서엔 "(보강)"이 붙는다.
  async function addMakeupStudent(studentId: string) {
    if (readonlyBlocked()) return;
    const res = await buildMakeupStudent(studentId, date || undefined); // 조회 중인 날짜 전달(과거 백필 중복게시 방지)
    if (!res.ok || !res.student) {
      toast.error(res.error ?? t("os.c.addStudentFail"));
      return;
    }
    // 보강을 **어느 수업 시간에** 하는지 = 지금 보고 있는 반 필터. 이게 반 필터 앵커가 된다(0171a) —
    // 앵커가 없으면(전체에서 추가·동명 반이라 특정 불가) 그 보강 행은 '전체'에서만 보인다.
    // 🔴 예전엔 앵커가 없어 보강 학생이 **모든 반 필터**에 나왔다(원장 제보 2026-08-03).
    // ⚠️ 이름은 **필터가 걸려 있으면 항상** 남긴다(id는 동명 반이면 특정 불가 → null). id가 없다고 이름까지
    //    비우면, 동명 반을 고른 채 보강을 추가했을 때 카드가 그 자리에서 사라진다 = 2026-07-27 그 버그 재발.
    const anchorName = classFilter === CLASS_TAG_ALL ? null : classFilter;
    const anchorId = matchingClasses.length === 1 ? matchingClasses[0]!.id : null;
    const withAnchor = (su: Subject): Subject => ({
      ...su,
      makeupClassId: anchorId,
      makeupClassName: anchorName,
    });
    // 🔴 과목 **키**로 거른다 — `TodayClass.subject`는 표시 라벨("수학")이라 키("math")와 비교하면 늘 거짓이고,
    //    반 칩을 고른 채 보강을 추가하면 보강 줄이 0개가 되어 저장이 "보강 날짜와 과목을 확인해 주세요"로 막혔다
    //    (원장 제보 2026-09-14 권영준·이수진). 키를 모르면("") 거르지 않는다(종전 '전체'와 같은 동작).
    const anchorSubject = matchingClasses.length === 1 ? matchingClasses[0]!.subjectKey || null : null;
    const mk = {
      ...res.student,
      subjects: res.student.subjects.filter(su => !anchorSubject || su.subjectKey === anchorSubject).map(withAnchor),
    };
    const existing = students.find((s) => s.id === studentId);
    if (!existing) {
      // 🔴 목록에 없던 학생도 **묻고 나서** 추가한다(원장 2026-08-19: *"이름 검색하고 누르면 그냥 추가되고
      //    끝이야"*). 예전엔 여기서 바로 카드를 만들어, 보강의 대다수인 "다른 반 학생"에서 결석분·시수를
      //    물을 자리가 아예 없었다. 카드는 확인 후 `resolveMakeupAsk`가 만든다(취소하면 아무 일도 없다).
      if (anchorName) {
        mk.tag = anchorName;
        mk.className = anchorName;
      }
      setMakeupAsk({
        studentId,
        studentName: mk.name,
        mk,
        candidates: [],
        sentSubjects: [],
        isNew: true,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        hostClasses: { options: [], loading: true },
      });
      void loadAbsences(studentId, anchorId);
      void loadHostClasses(studentId, mk.subjects);
      return;
    }
    // 🔴 **자동으로 합치지 않는다 — 묻는다**(원장 2026-08-06: *"선생님들이 헷갈린대"*).
    //    2026-08-05엔 정규 행이 있으면 말없이 합쳤는데(제목이 "(정규+보강)"이 되고 수업타임이 2가 된다),
    //    보강을 추가한 강사는 그 결과만 보게 돼 무슨 일이 일어난 건지 몰랐다.
    //    → `planMakeupMerge`가 후보를 고르고, 다이얼로그가 **합침 ↔ 분리 토글**로 물어본 뒤 고른 대로만 한다.
    //      · 합침 = 정규 행 1건에 합쳐 "(정규+보강)" 한 번만 발송(수업타임 +1)
    //      · 분리 = 종전(08-05 이전)대로 별도 "(보강)" 행 → 정규 1건 + 보강 1건, 2건 발송
    //    ⚠️ 후보를 고르는 3조건(내 과목·반 있는 정규 행·시수 올려도 되는 상태)은 그대로다 — 판정은
    //       [makeup-merge-plan.ts](../makeup-merge-plan.ts) 단일 소스(순수+Vitest).
    const teacherSubjectKeys = new Set(mk.subjects.map((su) => su.subjectKey).filter((k): k is string => !!k));
    const plan = planMakeupMerge(existing.subjects, teacherSubjectKeys);
    if (plan.kind === "already") {
      // 이미 합쳐 둔 과목이 있으면 **또 만들지 않는다** — 두 번 누르면 별도 "(보강)" 행이 생겨 보고서가
      // 결국 두 번 나간다. 예전 "이미 보강 행이 추가되어 있습니다"와 같은 규약.
      setSelId(existing.id);
      toast.message(
        tf("os.c.makeupAlready", { name: existing.name, subjects: plan.subjects.join("·") }),
      );
      return;
    }
    if (plan.kind === "ask") {
      // ⚠️ 이미 발송된 정규 보고서는 수정이 막혀 있다(발송본 잠금) — 합치면 보강 내용이 안 실린다는 사실을
      //    **고르기 전에** 다이얼로그에서 알린다(원장 2026-08-05 경고 요구를 선택 시점으로 앞당긴 것).
      const sentSubjects = plan.candidates
        .filter((c) =>
          isAlreadySent(
            effectiveClassnoteStatus(
              reports[studentId]?.[c.name]?.classnoteStatus,
              existing.subjects.find((su) => su.name === c.name)?.classnoteStatus,
            ),
          ),
        )
        .map((c) => c.name);
      setSelId(existing.id);
      setMakeupAsk({
        studentId,
        studentName: existing.name,
        mk,
        // 반 이름은 확인창 선택지 표시용(판정은 classId) — 행 이름("수학")만으론 어느 반인지 안 보인다.
        candidates: plan.candidates.map((c) => ({ ...c, className: todayClasses.find((x) => x.id === c.classId)?.name ?? null })),
        sentSubjects,
        isNew: false,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        // 🔴 정규 수업이 있어도 **다른 수업을 고를 수 있다**(원장 2026-09-21 *"보강을 항상 다른 수업을 고를 수 있게 해야 따로 보강 행이
        //    안생겨서 수납 분리가 쉬울듯"*) — 다니는 다른 반에 기록하면 출석부에 방문 줄이 안 생긴다. 오늘 정규 반은 목록에서 빠진다(`hostChoicesOf`).
        hostClasses: { options: [], loading: true },
      });
      // 반 필터가 '전체'면 앵커가 없다 — 그때는 **합칠 후보의 반**으로 좁힌다(위 헬퍼의 🔴 참조).
      void loadAbsences(studentId, anchorId ?? candidateAnchorClassId(plan.candidates));
      // 수업 후보도 **합칠 정규 수업의 과목**으로 좁힌다 — 두 과목을 가르치는 선생님이 '전체'에서 추가하면 결석 목록은 정규 수업 과목인데
      // 반 후보에 다른 과목 반이 섞여, 영어 반에 기록하면서 수학 결석에 메모를 달 수 있었다(적대 리뷰 2026-09-21). 과목 키를 모르면 종전대로.
      const candSubjects = mk.subjects.filter((su) => plan.candidates.some((c) => !!c.subjectKey && c.subjectKey === su.subjectKey));
      void loadHostClasses(studentId, candSubjects.length ? candSubjects : mk.subjects);
      return;
    }
    // 합칠 정규 행이 없다(그날 결석·다른 강사 과목 등) → **그래도 묻는다**. 결석 보강이 바로 이 경로라
    // 예전엔 가장 흔한 보강에서 결석분·시수를 물을 자리가 없었다(원장 2026-08-19).
    // 🔴 단 **더할 보강 행이 없으면**(같은 학생을 다시 추가) 창을 열지 않는다 — 열면 수업·시수·결석분을 고르게 해 놓고
    //    하나도 반영하지 못한다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
    if (pendingMakeupRows(existing, mk).length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return;
    }
    setMakeupAsk({
      studentId,
      studentName: existing.name,
      mk,
      candidates: [],
      sentSubjects: [],
      isNew: false,
      absences: EMPTY_ABSENCES,
      absencesLoading: true,
      hostClasses: { options: [], loading: true },
    });
    void loadAbsences(studentId, anchorId);
    void loadHostClasses(studentId, mk.subjects);
  }
  /**
   * 창에 보일 수업 후보 — 🔴 **그 학생이 다니는 반만**(원장 2026-09-21 *"해당 학생의 소속 수업만 띄워"*) · 그 학생이 **오늘 이 화면에
   * 정규 행이 있는 반은 뺀다**: 그 반은 정규 칸이 이미 있어 저장 훅이 보강 칸을 따로 세우지 않는다(합칠 수 없는 결석 등) — 보이면
   * "그 반에 기록합니다"가 지킬 수 없는 약속이 된다. 판정은 [`hostChoicesFor`] 한 곳(확인창도 같은 함수 · 기본값도 이 목록으로 본다).
   */
  function hostChoicesOf(ask: NonNullable<typeof makeupAsk>) {
    if (!ask.hostClasses) return undefined;
    const rows = students.find((s) => s.id === ask.studentId)?.subjects.filter((su) => !su.makeup && su.classId) ?? [];
    const regular = rows.map((su) => su.classId!);
    // 담임 반에 정규 칸이 있으면(합칠 수 없는 칸 포함) 확인창이 '반 없이'를 세우지 않는다 — 보고서 저장 훅이 보강 반을 안 만들어 시수가 아무 데도
    // 안 선다. 🔴 훅과 같은 **담임** 축이다: 위임받은 반의 칸은 훅이 못 본다(그 반 담임은 원래 담임이라 보강 반이 선다 — 막으면 되던 보강이 막힌다,
    // 재리뷰 2026-09-21). 오늘 반 목록에 없는 반은 담임 반으로 친다(모르면 막는 쪽 — 시수가 사라지는 것보다 낫다).
    const ownRegular = rows.some((su) => !todayClasses.find((c) => c.id === su.classId)?.delegated);
    return { ...ask.hostClasses, options: hostChoicesFor(ask.hostClasses.options, regular), regularToday: ownRegular };
    // ⚠️ `noneBlocked`(반별 발송 대상 — '반 없이' 금지)는 `ask.hostClasses`에 실려 그대로 넘어간다.
  }
  /** 보강을 기록할 수업 후보를 뒤늦게 채운다 — 창은 먼저 열고 목록만 갈아 끼운다(결석 조회와 같은 모양). */
  async function loadHostClasses(studentId: string, rows: readonly Subject[]) {
    const mine = ++hostSeq.current;
    // 후보는 보강 행 과목의 반만(등록 문이 과목까지 맞춰 본다) — 과목 키를 모르면 거르지 않는다.
    const subjects = [...new Set(rows.map((su) => su.subjectKey).filter((k): k is string => !!k))];
    const res = await fetchMakeupHostClasses(studentId, activeDate, subjects).catch(() => ({ options: [], failed: true }));
    if (mine !== hostSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId && prev.hostClasses
        ? { ...prev, hostClasses: { options: res.options, loading: false, failed: res.failed, noneBlocked: "noneBlocked" in res ? res.noneBlocked : false } }
        : prev,
    );
  }
  /**
   * **보강 반 고르기·바꾸기**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 후보 = 이 학생이 다니는 같은 과목 반(확인창과 같은 목록·같은 함수).
   * 고르면 서버 [`setMakeupClass`]가 보고서의 보강 반·보낼 반과 출석부 칸을 **함께** 옮긴다(보고서 전이면 명단 세션의 보강 반만).
   * 이미 발송된 보강은 서버가 거절한다(회수가 옛 반 기록으로 글을 찾는다).
   */
  async function pickMakeupClass(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    const subjectKey = su?.subjectKey || null;
    if (!su || !su.makeup || su.classId || !subjectKey) return;
    const res = await fetchMakeupHostClasses(student.id, activeDate, [subjectKey]).catch(() => ({ options: [], failed: true }));
    if (res.failed) {
      toast.error(t("os.c.sendClassCheckFail"));
      return;
    }
    const regular = student.subjects.filter((x) => !x.makeup && x.classId).map((x) => x.classId!);
    const options = hostChoicesFor(res.options, regular).filter((o) => o.subject === subjectKey);
    if (!options.length) {
      toast.error(t("os.makeupClass.noChoice"));
      return;
    }
    const picked = await askSendClass({
      studentName: student.name,
      candidates: options.map((o) => ({ id: o.classId, name: o.className })),
      defaultId: su.makeupClassId ?? null,
      makeupClassName: null,
      pickOnly: true,
    });
    if (!picked || picked === su.makeupClassId) return;
    const r = await setMakeupClass({ studentId: student.id, date: activeDate, subject: subjectKey, classId: picked });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    patch(student.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: r.className } : x)),
    }));
    toast.success(tf("os.makeupClass.changed", { name: r.className }));
  }
  /**
   * 결석 후보(이전 반 포함)를 뒤늦게 채운다 — 창은 먼저 열고 목록만 도착하면 갈아 끼운다.
   * 🔴 앵커 반을 함께 넘겨 **그 반 과목**의 결석만 받는다(수학 보강에 영어 결석이 뜨던 것,
   *    원장 제보 2026-08-19). 반 필터가 '전체'라 앵커가 없으면 종전대로 안 거른다.
   */
  async function loadAbsences(studentId: string, anchorClassId: string | null) {
    const mine = ++absenceSeq.current;
    const list = await fetchMakeupAbsences(studentId, activeDate, anchorClassId).catch(
      () => EMPTY_ABSENCES,
    );
    // 🔴 늦게 온 옛 조회는 버린다 — 학생이 같아도 **앵커(과목)가 다르면 다른 목록**이다.
    if (mine !== absenceSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId ? { ...prev, absences: list, absencesLoading: false } : prev,
    );
  }
  /**
   * 보강 빼기 — '+ 보강 학생 추가'의 반대(원장 2026-08-18 *"다 삭제"*). 출결 보강 칸과 저장된 보강
   * 보고서를 함께 지운다(서버 [`removeMakeupEntry`]). 되살아나는 원천이 둘이라 한쪽만 지우면
   * 새로고침에 그대로 돌아온다.
   * ⚠️ 학부모에게 나간 보고서는 **회수 요청만** 걸린다(게시글을 지울 열쇠가 그 행에 있다) — 그때는
   *    화면에서도 행을 지우지 않는다(`keepRow`). 안 그러면 "지웠는데 새로고침하면 있다"가 된다.
   */
  async function removeMakeupRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!su) return;
    // 🔴 **발송된 보강은 애초에 못 뺀다**(원장 2026-08-18 *"발송된건은 보강취소를 못하게 강제해"*).
    //    서버도 같은 판정으로 막지만 여기서 먼저 이유를 말한다 — 확인창을 띄웠다가 실패하면 더 나쁘다.
    const rep = reports[student.id]?.[subjectName];
    const blocked = makeupRemoveBlockReason(rep?.classnoteStatus ?? null);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    // 🔴 앵커가 이 학생의 **정규 반**이면 출결은 지우지 않는다(classId null) — 합칠 후보가 있던 '분리' 보강은 시수를 그 정규 칸에
    //    얹었고 보강 칸을 따로 만들지 않았다. 넘기면 누가 그 정규 칸을 '보강'으로 바꿔 둔 경우 정규 칸이 통째로 지워진다(적대 리뷰 2026-09-21).
    const anchorIsRegular = !!su.makeupClassId && student.subjects.some((x) => !x.makeup && x.classId === su.makeupClassId);
    // 경고는 **무엇이 사라지는지 그대로** 적는다(원장 *"경고하고 확인하면 삭제"*) — 정규 반 앵커면 출결은 안 지우고 남는 것을 밝힌다.
    const lines = [
      tf("os.c.removeMakeupTitle", { name: student.name }),
      "",
      anchorIsRegular
        ? tf("os.c.removeMakeupRegularLine", { cls: todayClasses.find((c) => c.id === su.makeupClassId)?.name ?? su.name })
        : t("os.c.removeMakeupLine1"),
      t("os.c.removeMakeupLine2"),
    ];
    if (!window.confirm(lines.join("\n"))) return;
    const res = await removeMakeupEntry({
      studentId: student.id,
      date: activeDate,
      classId: anchorIsRegular ? null : su.makeupClassId ?? null,
      subject: su.subjectKey ?? null,
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // 확인했으면 **화면에서도 없앤다**(원장 *"아무것도 추가 안한것처럼 이전으로"*) — 지울 수 있는 행만
    // 여기까지 오므로 DB에도 남는 게 없다. 남은 행이 없으면 카드째 목록에서 제거(보강만 있던 학생).
    setStudents((prev) =>
      prev
        .map((s) =>
          s.id === student.id
            ? withMark({
                ...s,
                subjects: s.subjects.filter((x) => x.name !== subjectName),
                // 지운 보강 칸이 배지 재료(`attendanceOffRow`)에 남아 있으면 없는 기록이 배지에 계속 선다.
                ...(!anchorIsRegular && su.makeupClassId && s.attendanceOffRow && su.makeupClassId in s.attendanceOffRow
                  ? {
                      attendanceOffRow: Object.fromEntries(
                        Object.entries(s.attendanceOffRow).filter(([cid]) => cid !== su.makeupClassId),
                      ),
                    }
                  : {}),
              })
            : s,
        )
        .filter((s) => !(s.id === student.id && s.subjects.length === 0)),
    );
    toast.success(res.message);
  }
  /**
   * 다이얼로그 응답 처리 — 고른 대로만 한다. 취소는 아무것도 하지 않는다(보강 행도 안 생긴다).
   * ⚠️ 학생은 **id로 다시 찾는다** — 다이얼로그가 열려 있는 동안 실시간 갱신이 카드를 바꿨을 수 있다.
   */
  async function resolveMakeupAsk(picked: MakeupConfirmChoice) {
    const asked = makeupAsk;
    if (!asked || makeupSaving) return;
    // 🔴 합칠 후보는 **창을 연 순간의 스냅샷**이다 — 그 사이 이 화면이 알게 된 변화(같은 문서 방송·자기 응답의 conflict 되돌리기)로
    //    그 칸이 결석 등이 됐는데 옛 상태로 되쓰면 결석이 출석으로 뒤집히고 옛 시수에 더해진다(적대 리뷰 2026-09-21).
    //    확인하는 순간의 카드로 같은 판정(`planMakeupMerge`)을 다시 돌려, 더는 합칠 수 없으면 멈추고 지금 값으로 이어 간다.
    //    ⚠️ **다른 기기의 변화는 못 본다**(카드는 실시간 구독이 없다) — 그 방어는 서버가 쓰기 때 상태를 다시 보는 것이다(미착수).
    let choice = picked;
    if (picked.candidate) {
      const was = picked.candidate;
      const card = studentsRef.current.find((s) => s.id === asked.studentId);
      const plan = card ? planMakeupMerge(card.subjects, new Set([was.subjectKey])) : null;
      const fresh = plan?.kind === "ask" ? plan.candidates.find((c) => c.name === was.name && c.classId === was.classId) : undefined;
      if (!fresh) {
        setMakeupAsk(null);
        toast.error(tf("os.c.makeupCandidateChanged", { target: was.name }));
        return;
      }
      choice = { ...picked, candidate: fresh };
    }
    // 창에서 **수업을 골랐으면** 그 반이 앵커다(원장 2026-09-21) — 보고서의 `makeup_class_id`와 출결 칸이 모두 그 반을 본다.
    // `null` = '반 없이'(보이지 않는 보강 반 — 종전 동작). 묻지 않았으면(`undefined`) 반 필터 앵커 그대로.
    // 🔴 고른 반과 **과목이 같은 행만** 남긴다 — 다른 과목 행까지 그 반에 묶으면 등록 문이 통째로 거절한다(적대 리뷰 2026-09-21).
    // ⚠️ 카드 표시 이름(`makeupClassName`)은 보고 있던 반 필터가 있으면 그대로(바꾸면 추가한 카드가 그 자리에서 사라진다),
    //    '전체'였으면 고른 반 이름(새로고침 뒤 그 반 칩 아래로 옮겨 가 보이는 것과 같게).
    // 🔴 고른 반은 **지금 창에 보이는 후보**에서 찾는다 — 창이 열린 사이 그 반에 정규 행이 생기면 후보에서 빠지는데,
    //    거르기 전 목록에서 찾으면 요약 문장('보강 반에 기록')과 다른 반으로 나간다(적대 리뷰 2026-09-21).
    const host = choice.hostClassId === undefined || choice.hostClassId === null
      ? null
      : hostChoicesOf(asked)?.options.find((o) => o.classId === choice.hostClassId) ?? null;
    if (typeof choice.hostClassId === "string" && !host) {
      toast.error(t("os.c.makeupHostGone"));
      return;
    }
    // 반 필터가 '전체'였나 — 그때만 카드 이름을 고른 반으로 바꾼다(서버가 tag를 늘 "보강"으로 채워 tag로는 가를 수 없다).
    const filterAll = !asked.mk.subjects.some((su) => su.makeupClassName);
    const hosted = choice.hostClassId === undefined
      ? asked
      : {
          ...asked,
          mk: {
            ...asked.mk,
            ...(host && filterAll ? { tag: host.className, className: host.className } : {}),
            subjects: asked.mk.subjects
              .filter((su) => !host || !su.subjectKey || su.subjectKey === host.subject)
              .map((su) => ({ ...su, makeupClassId: choice.hostClassId ?? null, makeupClassName: su.makeupClassName ?? host?.className ?? null })),
          },
        };
    // 🔴 합칠 후보가 있는 보강을 **분리**하면 보강 줄의 앵커도 고른 정규 수업(후보) 반이다 — 시수가 그 반 칸에 얹히므로(아래),
    //    보고서 저장 훅이 그 반 칸을 보고 보강 반을 또 만들지 않는다(위임 반이면 담임 판정이 못 잡는다). 표시 이름은 그대로 둔다
    //    (바꾸면 추가한 카드가 보던 반 필터에서 그 자리에서 사라진다 — 새로고침 뒤엔 후보 반 칩 아래에 선다).
    const target = choice.candidate && choice.mode === "separate" ? choice.candidate : null;
    // 보던 반 필터가 후보 반과 다르면 새로고침 뒤 카드가 후보 반 칩 아래로 옮겨 간다 — 조용히 옮기지 않고 알린다.
    // ⚠️ 판정은 **이름**으로 — 반 필터가 이름 축이라(grid.ts) 동명 반 필터(앵커 id 없음)에선 옮겨 가지 않는다.
    const targetClassName = target ? todayClasses.find((c) => c.id === target.classId)?.name ?? null : null;
    const movedTo = target && targetClassName && hosted.mk.subjects.some((su) => su.subjectKey === target.subjectKey && !!su.makeupClassName && su.makeupClassName !== targetClassName)
      ? targetClassName
      : null;
    const ask = target
      ? { ...hosted, mk: { ...hosted.mk, subjects: hosted.mk.subjects.map((su) => (su.subjectKey === target.subjectKey ? { ...su, makeupClassId: target.classId } : su)) } }
      : hosted;
    // 창에서 **다른 반**을 골랐는데 보던 반 필터와 이름이 다르면 새로고침 뒤 그 보강은 고른 반 이름 아래로 옮겨 간다 — 그 반이 오늘 칩에
    // 없으면 '전체'에서만 보인다. 조용히 옮기지 않고 알린다(정규 수업이 있는 학생이 다른 반을 고르는 것이 이 경로의 흔한 경우다).
    const hostMoved = host && ask.mk.subjects.some((su) => !!su.makeupClassName && su.makeupClassName !== host.className) ? host.className : null;
    const hostNote = hostMoved
      ? todayClasses.some((c) => c.name === hostMoved)
        ? tf("os.c.makeupShownUnder", { target: hostMoved })
        : tf("os.c.makeupShownUnderAll", { target: hostMoved })
      : undefined;
    const withHostNote = (msg: string) => (hostNote ? `${msg} ${hostNote}` : msg);
    // 🔴 더할 보강 행이 없으면 **등록하기 전에** 멈춘다 — 등록이 먼저 돌면 고른 수업·시수가 세션에 적히는데 카드 행은
    //    옛 앵커 그대로라, 새로고침 뒤 카드가 칸 없는 반을 가리키고 보고서 저장 때 보강 반 칸이 하나 더 선다(적대 리뷰 2026-09-21).
    //    목록에 없던 학생(isNew)이라도 창이 열린 사이 카드가 들어왔을 수 있어 id로 다시 찾는다.
    const cardNow = studentsRef.current.find((s) => s.id === ask.studentId);
    // 🔴 **합침도** 같은 과목 보강 행이 이미 있으면 멈춘다 — 다른 반을 골라 만든 보강 행(`planMakeupMerge`의 `already`는 반에 합친 행만 본다)이
    //    있는 학생을 다시 추가해 합치면 정규 칸에 보강이 한 번 더 얹혀 두 번 잡힌다(재리뷰 2026-09-21).
    const stopSubject = choice.candidate ? choice.candidate.subjectKey : undefined;
    if (cardNow && (!choice.candidate || stopSubject) && pendingMakeupRows(cardNow, ask.mk, stopSubject).length === 0) {
      setMakeupAsk(null);
      setSelId(cardNow.id);
      toast.message(t("os.c.makeupRowExistsNoChange"));
      return;
    }
    if (choice.mode === "separate") {
      const existing = studentsRef.current.find(s => s.id === ask.studentId);
      const attended = new Set(existing?.subjects.filter(su => !su.makeup).map(su => su.subjectKey));
      const attendedRows = ask.mk.subjects.filter(su => attended.has(su.subjectKey));
      const rows = choice.candidate
        ? ask.mk.subjects.filter(su => su.subjectKey === choice.candidate!.subjectKey)
        : attendedRows.length ? attendedRows : ask.mk.subjects;
      setMakeupSaving(true);
      try {
        const result = await registerMakeupEntries({
          studentId: ask.studentId, date: activeDate,
          entries: rows.map(su => ({
            subject: su.subjectKey || su.name, makeupClassId: su.makeupClassId,
            absentDate: choice.absentDate, absentClassId: choice.absentClassId, units: choice.addUnits,
            // 🔴 정규 수업에 기록하지 않는 보강이면 **지금** 앵커 반에 칸을 세운다(서버가 저장 훅과 같은 함수로) — 보고서를 안 쓰거나
            //    저장이 실패해도 시수가 남게(적대 리뷰 2026-09-30). 후보 반에 얹는 분리 보강·그 반에 오늘 정규 줄이 있는 학생은 끈다
            //    (그 칸은 화면이 직접 얹는다 — 옛 `persistAnchorMakeup`과 같은 조건).
            recordCell: !choice.candidate && !!su.makeupClassId && !existing?.subjects.some((x) => x.classId === su.makeupClassId && !x.makeup),
          })),
        });
        if (!result.ok) { toast.error(result.error); return; }
        if (result.cellError) toast.error(tf("os.c.anchorFail", { error: result.cellError }));
        notifyMakeupEffect(result.makeupEffect);
        // 내 리비전에 명단만 더한 경우에만 자동저장 기준도 전진시킨다. 다른 창의 내용에는 소유권을 얻지 않는다.
        if (existing && (existing.sessionUpdatedAt ?? null) === result.previousUpdatedAt) {
          applySessionSaveResult(existing.id, result);
        }
      } catch {
        toast.error(t("os.c.makeupSaveFail"));
        return;
      } finally { setMakeupSaving(false); }
    }
    setMakeupAsk(null);
    const anchorIdNew = ask.mk.subjects.find((su) => su.makeupClassId)?.makeupClassId ?? null;
    // '반 없이'를 골랐는가 — 앵커가 없는 이유가 반 필터가 아니라 강사의 선택이라 문구가 다르다.
    const noAnchorToast = choice.hostClassId === null ? "os.c.makeupAddedNoHost" : "os.c.makeupAddedNoAnchor";
    // 목록에 없던 학생이라도 창이 열린 사이 카드가 실시간으로 들어왔으면 **기존 카드 경로**로 보낸다 — 새 카드 경로로 가면
    // 그 카드의 앵커 칸과 고른 반 칸이 둘 다 선다(적대 리뷰 2026-09-21).
    if (ask.isNew && !studentsRef.current.some((s) => s.id === ask.studentId)) {
      // 목록에 없던 학생 — 확인을 받았으니 이제 카드를 만든다(취소했으면 여기 안 온다).
      const mk = ask.mk;
      setStudents((prev) => (prev.some((s) => s.id === mk.id) ? prev : [...prev, mk]));
      setReports((prev) => ({ ...prev, [mk.id]: initReports([mk], templatePrefsRef.current)[mk.id] ?? {} }));
      setSelId(mk.id);
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(mk.id, anchorIdNew, choice, mk.name, hostNote);
      } else {
        // ⚠️ 앵커(보고 있는 반)가 없으면 출결에 남길 칸이 없다 — 시수를 약속하지 않는다(지킬 수 없다).
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: mk.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: mk.name }),
        );
      }
      return;
    }
    const existing = studentsRef.current.find((s) => s.id === ask.studentId);
    if (!existing) {
      toast.error(t("os.c.cardNotFound"));
      return;
    }
    if (!choice.candidate) {
      // 정규 수업에 기록하지 않는 보강(정규 행이 없음 — 그날 결석·다른 강사 과목 — 또는 창에서 다른 반을 고름) — 보강 행만 만들고
      // 시수·결석분은 앵커 반(고른 반 · 보던 반 필터)에 적는다.
      // 🔴 이미 보강 행이 있으면(같은 학생을 다시 추가) **여기서 멈춘다** — 계속 가면 고른 반에 칸이 하나 더 서서 시수가 두 번 잡히고,
      //    카드 행의 앵커는 옛 값이라 보강 빼기가 그 칸을 못 지운다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
      if (!addSeparateMakeupRows(existing, ask.mk)) return;
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(existing.id, anchorIdNew, choice, existing.name, hostNote);
      } else {
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: existing.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: existing.name }),
        );
      }
      return;
    }
    // 🔴 합칠 후보가 있는 보강은 **보던 반 필터에 보강 칸을 따로 적지 않는다** — 시수는 고른 정규 수업 칸에만 얹힌다(합침·분리 둘 다).
    //    예전엔 여기서 `persistAnchorMakeup`을 불러, 보던 반(X)이 후보 반(Y)과 다르면 **한 번의 보강이 두 반에** 잡혔다
    //    (X 보강 1 + Y +시수 — 실측 2026-08-29 정민성 · 2026-09-17 안서준, 원장 *"출석부에 행만 자꾸 생기네"*).
    if (choice.mode === "separate") {
      // 🔴 **고른 과목의 보강 행만** 만든다. 안 좁히면 그 강사가 가르치는 학생의 다른 과목까지 "(보강)" 행이
      //    딸려 붙어(예: 영어가 오늘 결석이라 후보엔 없어도 행은 생겼다) 보고서가 2건이 아니라 3건 나간다 —
      //    다이얼로그가 "모두 2건" 이라고 약속한 것과 어긋난다. 강사가 어느 수업인지 이미 골랐으니 추측할 게 없다.
      if (addSeparateMakeupRows(existing, ask.mk, true, choice.candidate!.subjectKey)) {
        // 🔴 결석일은 **선택**이다(원장 2026-08-07 *"오늘 날짜에 추가 보강할 수도 있잖아"*). 없으면
        //    결석분 연결 없이 시수만 얹는다. 예전엔 이 분기가 없어 날짜가 비면 **조용히 '합침'으로**
        //    떨어졌다 — 강사는 '분리'를 골랐는데 보고서가 1건만 나가는, 화면과 다른 결과였다.
        const note = movedTo ? tf("os.c.makeupShownUnder", { target: movedTo }) : undefined;
        if (choice.absentDate)
          void linkMakeupAbsence(existing, choice.candidate!, choice.absentDate, choice.addUnits, choice.absentClassId, note);
        else void addMakeupUnitsOnly(existing, choice.candidate!, choice.addUnits, note);
      }
      return;
    }
    mergeMakeupIntoRegular(
      existing,
      choice.candidate,
      choice.addUnits,
      ask.sentSubjects.includes(choice.candidate.name),
    );
  }
  /**
   * 정규 행이 없는 보강의 결석분 연결 — 시수는 **오늘 보강한 반**(앵커)에, 메모는 **결석이 난 반**에.
   * 🔴 이월 보강(반 이동)은 두 반이 다르다 — 하나로 묶으면 옛 반에 시수가 붙어 급여 귀속이 틀린다.
   */
  async function linkMakeupToAbsenceCell(
    studentId: string,
    makeupClassId: string,
    choice: MakeupConfirmChoice,
    name: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 옮겨 가는 반) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    // 🔴 시수는 등록 문(`registerMakeupEntries` — 못 세웠으면 보고서 저장 훅)이 그 반 칸을 세울 때 적었다 — 여기선 **메모만**(합산 액션을 쓰면 두 번 더해진다).
    const res = await noteMakeupAgainstAbsence({
      studentId,
      makeupClassId,
      makeupDate: activeDate,
      absentClassId: choice.absentClassId ?? makeupClassId,
      absentDate: choice.absentDate!,
    });
    if ("error" in res) {
      toast.error(tf("os.c.absenceLinkFail", { error: res.error }));
      return;
    }
    const msg = res.absenceNoted
      ? tf("os.c.makeupNoted", {
          name,
          date: shortDate(choice.absentDate!),
          units: choice.addUnits,
        })
      : tf("os.c.makeupNoRecord", {
          name,
          units: choice.addUnits,
          date: shortDate(choice.absentDate!),
        });
    toast.success(note ? `${msg} ${note}` : msg);
  }
  /**
   * 분리 보강을 **결석분에 연결** — 결석한 날 칸엔 메모만("N/N 보강 예정", 결석 0은 그대로),
   * 보강한 날(=보고 있는 날짜) 칸엔 시수 +addUnits + 메모("N/N 결석분 보강"). 원장 2026-08-06 사양이자
   * 현재 구글시트 출석부 운영과 같은 모양. 낙관 표시는 보강한 날 행에만 반영한다.
   */
  async function linkMakeupAbsence(
    existing: OneScreenStudent,
    target: MergeCandidate,
    absentDate: string,
    addUnits: number,
    absentClassId?: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 카드가 옮겨 가는 반 등) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    const withNote = (msg: string) => (note ? `${msg} ${note}` : msg);
    const res = await linkMakeupToAbsence({
      studentId: existing.id,
      classId: target.classId,
      absentDate,
      // 이월 보강 — 결석이 난 반이 다르면 메모는 그 반 칸에 붙는다(시수는 target 반).
      absentClassId,
      makeupDate: activeDate,
      addUnits,
    });
    if ("error" in res) {
      toast.error(tf("os.c.makeupUnitsFail", { error: res.error }));
      return;
    }
    // 화면의 그 행 시수도 서버 결과로 맞춘다(1이면 서버가 null로 접으므로 같은 규칙으로).
    // ⚠️ 기록이 없던 날엔 서버가 '출석'으로 열었다 — 화면 raw도 같이 present로 맞춰야 표시가 안 갈린다.
    // 조퇴 칸이면 raw는 조퇴 그대로 — 배지는 행에서 다시 계산한다(`studentMarkFromRows`, 조퇴는 '조퇴').
    const linkedRaw = target.attendanceRaw ?? "present";
    applyAttendanceLocal(existing.id, target.classId, linkedRaw, { units: res.units === 1 ? null : res.units });
    if (res.alreadyLinked) {
      toast.message(withNote(tf("os.c.makeupAlreadyLinked", { date: shortDate(absentDate) })));
      return;
    }
    // ⚠️ 결석 기록이 없던 날이면 메모를 안 남긴다 — 조용히 넘기지 말고 그 사실을 밝힌다.
    toast.success(withNote(
      res.absenceNoted
        ? tf("os.c.makeupNoted2", {
            name: existing.name,
            date: shortDate(absentDate),
            target: target.name,
            units: res.units,
          })
        : // 선보강(아직 안 지난 날)이면 "기록이 없다"가 아니라 **아직 오지 않았다**가 사실이다 —
          //    같은 문장으로 뭉뚱그리면 강사가 "왜 기록이 없지?" 하고 출석부를 뒤진다.
          absentDate > activeDate
          ? tf("os.c.makeupFuture", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })
          : tf("os.c.makeupNoRecord2", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })),
      { duration: 8000 },
    );
  }
  /** 합침 — 정규 행에 보강 표시를 켜고(제목 "(정규+보강)", makeup-label.ts) 출석부 수업타임을 얹는다. */
  /**
   * 추가 보강(결석분 연결 없음) — 보강 행은 이미 따로 만들었고, 여기서는 **그 날 칸의 시수만** 올린다.
   * ⚠️ 정규 행에 `makeup: true`를 켜지 않는다 — 그건 '합침'(제목 "(정규+보강)", 보고서 1건)의 표시다.
   *    분리는 보고서가 2건이므로 정규 행은 정규 그대로 둔다.
   */
  function addMakeupUnitsOnly(existing: OneScreenStudent, target: MergeCandidate, addUnits: number, note?: string) {
    const units = (target.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      target.classId,
      mergeStatusOf(target.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 보강 시수 합산은 성공 안내를 이미 띄웠다 — conflict no-op이면 안내가 거짓이 된다
    );
    setSelId(existing.id);
    const msg = tf("os.c.makeupExtra", { name: existing.name, target: target.name, units });
    toast.success(note ? `${msg} ${note}` : msg, { duration: 8000 });
  }

  function mergeMakeupIntoRegular(
    existing: OneScreenStudent,
    merge: MergeCandidate,
    addUnits: number,
    sent: boolean,
  ) {
    patch(existing.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === merge.name ? { ...x, makeup: true } : x)),
    }));
    // 수업타임 = 지금 값(미입력=1) + 강사가 고른 보강 시수. 출결이 비어 있으면 '출석'으로 함께 찍힌다.
    // 🔴 조퇴 칸은 **조퇴 그대로**(`mergeStatusOf`) — 메모(조퇴 사유)는 안 보내므로 서버가 그대로 둔다(원장 2026-09-30).
    // 🔴 보강 시수를 1로 박지 않는다 — 수학은 0.5당 1시간이라 3시간 반의 1회는 1.5다(원장 2026-08-06).
    const units = (merge.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      merge.classId,
      mergeStatusOf(merge.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 합침 시수 합산도 위와 동일 — 비파괴 보호는 알약 첫 체크 전용
    );
    setSelId(existing.id);
    if (sent) {
      // 발송본 잠금이라 보강 내용은 못 싣는다 — 다이얼로그에서 이미 알렸지만 결과도 그대로 밝힌다.
      toast.warning(
        // ⚠️ 숫자 뒤 조사 금지(받침이 값마다 다르다 — 2=이/3=삼) → 수치는 괄호로 뗀다.
        tf("os.c.mergeSent", { name: existing.name, target: merge.name, units }),
        { duration: 10000 },
      );
    } else {
      toast.success(tf("os.c.merged", { name: existing.name, target: merge.name, units }));
    }
  }
  /**
   * 분리 — 종전(2026-08-05 이전)대로 별도 "(보강)" 행. 정규와 별개 보고서라 발송도 따로 나간다.
   * @returns 행이 실제로 늘었는가 — 호출부가 이 값으로 결석분 연결(시수 +1)을 걸지 판단한다.
   */
  /**
   * 이 카드에 **더할 보강 행**(이름 붙이기 전) — `addSeparateMakeupRows`와 창을 열기/등록하기 전 멈춤이 같은 판정을 쓴다.
   * 비어 있으면 같은 과목 보강 행이 이미 있다는 뜻이다.
   */
  function pendingMakeupRows(existing: OneScreenStudent, mk: OneScreenStudent, onlySubjectKey?: string): Subject[] {
    // mk.subjects는 강사의 **모든 담당 과목**이라, 그대로 병합하면 math만 듣는 학생 카드에 '영어 (보강)' 잡행까지
    // 붙는다(2026-07-24 적대검수). 학생이 실제 수강하는 과목(정규+특강 행)으로 좁히되, 겹치는 과목이 하나도 없으면
    // (학생이 안 듣는 과목의 순수 추가보강) 종전대로 전체를 후보로 둔다.
    const attended = new Set(existing.subjects.filter((su) => !su.makeup).map((su) => su.subjectKey));
    const attendedRows = mk.subjects.filter((su) => attended.has(su.subjectKey));
    const source = onlySubjectKey
      ? mk.subjects.filter((su) => su.subjectKey === onlySubjectKey)
      : attendedRows.length
        ? attendedRows
        : mk.subjects;
    // 같은 과목 보강 행이 이미 있으면 중복 추가 안 함.
    return source.filter((su) => !existing.subjects.some((ex) => ex.makeup && !ex.classId && ex.subjectKey === su.subjectKey));
  }
  function addSeparateMakeupRows(
    existing: OneScreenStudent,
    mk: OneScreenStudent,
    silent = false,
    /** 지정하면 **그 과목 행만** 만든다(다이얼로그에서 강사가 고른 수업). 미지정=종전대로 전 과목 후보. */
    onlySubjectKey?: string,
  ): boolean {
    const studentId = existing.id;
    // 이름 유일화(reports 키 충돌 방지)로 초안 덮어쓰기 차단.
    const used = new Set(existing.subjects.map((su) => su.name));
    const makeupRows = pendingMakeupRows(existing, mk, onlySubjectKey)
      .map((su) => {
        let name = makeupRowName(su.name);
        let n = 2;
        while (used.has(name)) name = makeupRowName(su.name, n++);
        used.add(name);
        // ⚠️ classId=null·makeup=true 유지(반 무관 보강). subjectLabel은 깨끗한 라벨 — 진도 접두에 "(보강)" 누출 방지.
        // 반 필터 앵커(makeupClassId/Name)는 `mk`에 이미 실려 있다 — **'추가'를 누른 시점**의 반 필터라,
        // 다이얼로그를 띄워 두는 동안 강사가 필터를 바꿔도 보강이 엉뚱한 수업에 붙지 않는다.
        return { ...su, name, classId: null, makeup: true, subjectLabel: su.subjectLabel ?? su.name };
      });
    if (makeupRows.length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return false;
    }
    patch(studentId, (s) => ({ ...s, subjects: [...s.subjects, ...makeupRows] }));
    const slots = initReports([{ ...existing, subjects: makeupRows }], templatePrefsRef.current)[existing.id] ?? {};
    setReports((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? {}), ...slots } }));
    setSelId(studentId);
    // 결석분 연결이 뒤따르는 경로(다이얼로그 '분리')는 그쪽 토스트가 시수까지 밝히므로 여기선 조용히(silent).
    setCardSubject({ id: studentId, idx: existing.subjects.length });
    if (!silent) toast.success(tf("os.c.makeupAdded", { name: existing.name }));
    return true;
  }
  // 보강 학생 '이전 진도 불러오기' — 직전 회차를 당겨 prev/prevReport/prevScore를 채운다(세션 저장 없음).
  //   silent = 일괄 불러오기(아래)가 결과를 모아 한 번에 알린다.
  async function loadMakeupPrev(studentId: string, silent = false): Promise<"loaded" | "none" | "fail"> {
    const res = await loadMakeupHistory(studentId, date || undefined); // 조회 중인 날짜 기준 직전 회차(과거 백필 정합)
    if (!res.ok || !res.bySubject) {
      if (!silent) toast.error(res.error ?? t("os.c.prevFail"));
      return "fail";
    }
    const bySubject = res.bySubject;
    const prevScore = res.prevScore;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        return {
          ...s,
          subjects: s.subjects.map((su) => {
            const h = bySubject[su.subjectKey ?? ""] ?? bySubject[su.name];
            return h ? { ...su, prev: h.prev, prevReport: h.prevReport } : su;
          }),
          tests: prevScore
            ? {
                daily: { ...s.tests.daily, prevScore: prevScore.daily },
                check: { ...s.tests.check, prevScore: prevScore.check },
              }
            : s.tests,
        };
      }),
    );
    setPrevLoaded((prev) => new Set(prev).add(studentId));
    const found = Object.keys(bySubject).length > 0;
    if (!silent) toast.success(found ? t("os.c.prevLoaded") : t("os.c.prevNone"));
    return found ? "loaded" : "none";
  }
  // 보강 학생 이전 진도 **일괄** 불러오기(원장 2026-10-27 *"보강학생이 따로 있으면 안내하고 버튼도"*) — 표의 '이전값 가져오기'는
  // 이전 회차가 있는 행만 채운다. 보강 학생은 그 회차를 따로 불러와야 해서, 안 불러온 보강 학생이 있으면 표 위에 안내 버튼이 선다.
  async function loadMakeupPrevAll(ids: string[]) {
    if (makeupPrevBusyRef.current || !ids.length) return;
    makeupPrevBusyRef.current = true;
    setMakeupPrevBusy(true);
    try {
      let loaded = 0;
      let failed = 0;
      for (const id of ids) {
        const r = await loadMakeupPrev(id, true); // 한 명씩 — 서버 액션은 어차피 줄 서서 돈다
        if (r === "loaded") loaded++;
        else if (r === "fail") failed++;
      }
      if (failed) toast.error(tf("os.c.makeupPrevAllFail", { n: failed }));
      if (failed < ids.length) toast.success(tf("os.c.makeupPrevAllDone", { n: loaded, none: ids.length - loaded - failed }));
    } finally {
      makeupPrevBusyRef.current = false;
      setMakeupPrevBusy(false);
    }
  }
  function setScoreFor(studentId: string, subjectName: string, which: "daily" | "check", v: number | null) {
    wt(studentId, subjectName, which === "daily" ? "dailyTest" : "checkTest");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, [which === "daily" ? "dailyScore" : "checkScore"]: v }));
  }
  // 테스트 만점(/N) 변경 — 학원설정 allowTeacherTestMax on일 때만 UI 노출. 점수가 새 만점 초과면 함께 클램프.
  function setMaxFor(studentId: string, subjectName: string, which: "daily" | "check", v: number) {
    wt(studentId, subjectName, which === "daily" ? "dailyTest" : "checkTest");
    const max = Math.max(1, Math.min(100, Math.round(v) || 1));
    patchRowEval(studentId, subjectName, (su) => {
      const cur = which === "daily" ? su.dailyScore : su.checkScore;
      const score = cur != null ? Math.min(cur, max) : cur;
      return which === "daily"
        ? { ...su, dailyMax: max, dailyScore: score }
        : { ...su, checkMax: max, checkScore: score };
    });
  }
  // ── 출결 인라인 입력(2-2) — 출석부와 같은 기록(setAttendanceCell 재사용). 행(반) 단위 raw 보존 ──
  // 학생 배지는 **행 raw에서 계산**한다([attendance-mark.ts](../attendance-mark.ts) `studentMarkFromRows` 단일 소스 —
  // 로스터·스트립 반영과 같은 함수, 우선순위 결석 > 조퇴 > 지각 > 출석). 배지를 따로 들고 다니지 않으므로
  // 롤백·응답 역전이 와도 배지가 행과 갈리지 않는다(예전 compare-and-swap 롤백이 필요 없어졌다).
  const withMark = (s: OneScreenStudent): OneScreenStudent => ({ ...s, attendance: studentMarkFromRows(s) });
  function applyAttendanceLocal(
    studentId: string,
    classId: string,
    raw: string | null,
    extra?: { note?: string | null; units?: number | null },
  ) {
    patch(studentId, (s) => withMark({
      ...s,
      subjects: s.subjects.map((su) =>
        su.classId === classId
          ? {
              ...su,
              attendanceRaw: raw,
              // 안 넘긴 필드는 **건드리지 않는다** — 서버 규약(undefined=기존 유지)과 같게 맞춰야
              // 낙관 화면과 실제 기록이 갈리지 않는다(메모만 고쳤는데 시수가 1로 되돌아가는 일 방지).
              ...(extra && "note" in extra ? { attendanceNote: extra.note ?? null } : {}),
              ...(extra && "units" in extra ? { attendanceUnits: extra.units ?? null } : {}),
            }
          : su,
      ),
    }));
  }
  // 실패 롤백 — 이 행 raw만 되돌리고 배지는 행에서 다시 계산한다. 그 사이 다른 반 pill 갱신은 그 행 raw에
  // 남아 있으므로 배지에 그대로 반영된다(#17: 앞 요청 롤백이 뒤 성공 배지를 지우던 문제 — 구조로 해소).
  function rollbackAttendance(
    studentId: string,
    classId: string,
    prev: { raw: string | null; note: string | null; units: number | null },
  ) {
    patch(studentId, (s) => withMark({
      ...s,
      subjects: s.subjects.map((su) =>
        su.classId === classId
          ? { ...su, attendanceRaw: prev.raw, attendanceNote: prev.note, attendanceUnits: prev.units }
          : su,
      ),
    }));
  }
  // 출결 취소(null)도 같은 저장 경로를 쓴다. (학생×반) 저장 중 잠금 + 실패 시 상태·메모·시수 복구.
  // 낙관 갱신으로 pill 즉시 반응(반응속도 1순위) — 서버 검증(담당 반·수강생)은 setAttendanceCell이 강제.
  //
  // extra(2026-08-05) = 지각·결석 **사유 메모**·**수업타임(시수)**. 셋 다 출석부의 같은 행이라 한 왕복으로
  // 저장한다. ⚠️ 상태가 그대로여도 메모·시수만 바꾸는 호출은 **통과시켜야** 한다(예전 재클릭 no-op을 그대로
  // 두면 "지각 사유만 고치기"가 조용히 무시된다).
  async function setAttendanceFor(
    studentId: string,
    classId: string,
    /** 알약은 3종만 보낸다 — `early_leave`는 보강 합침이 **조퇴 칸을 조퇴로 보존**하며 시수만 올릴 때뿐(`mergeStatusOf`). */
    status: AttendanceSelection | "early_leave",
    extra?: { note?: string | null; units?: string },
    opts?: {
      /**
       * true = 화면상 기록이 없어도 **덮어쓰기 허용**(onlyIfEmpty 비파괴를 끈다) — 보강 합침/추가 흐름 전용.
       * 그 흐름은 화면 값 기준으로 시수 합을 이미 계산해 성공 안내까지 띄우므로, 여기서 conflict no-op이
       * 되면 "수업타임 N" 안내와 실제 기록이 갈린다(적대 리뷰 확정). 종전(비파괴 도입 전) 의미 그대로.
       */
      overwrite?: boolean;
    },
  ) {
    const key = `${studentId}::${classId}`;
    if (attPending.has(key)) return;
    const stu = studentsRef.current.find((s) => s.id === studentId);
    const row = stu?.subjects.find((su) => su.classId === classId);
    const prev = {
      raw: row?.attendanceRaw ?? null,
      note: row?.attendanceNote ?? null,
      units: row?.attendanceUnits ?? null,
    };
    const changesExtra = extra !== undefined && ("note" in extra || "units" in extra);
    if (prev.raw === status && !changesExtra) return;
    setAttPending((p) => new Set(p).add(key));
    /**
     * 🔴 **첫 기록 + 숫자 안 고름** = 서버가 수학 수업 길이 자동 시수를 넣는다(auto-units.ts, 2026-09-11).
     *    화면 '타임'도 같은 값으로 먼저 칠하고, 응답의 `autoUnits`(실제 저장값)로 다시 맞춘다 — 서버 조회가
     *    실패하면 null(=1)이 들어가므로 낙관값만 믿으면 화면과 기록이 갈린다. 결석은 시수를 안 쓴다.
     */
    const autoOnInsert = status !== null && prev.raw === null && !(extra && "units" in extra) && status !== "absent";
    // 낙관 표시용 시수 — 서버가 "1이면 null로 정규화"하므로 화면도 같은 규칙으로 미리 접는다.
    const optimisticUnits =
      extra && "units" in extra
        ? // ⚠️ 서버 parseSessionUnits는 쉼표 소수점("1,5")도 받는다 — 여기서 Number()에 그대로 넣으면 NaN이
          //    되어 화면만 1로 접히고 DB엔 1.5가 저장된다(화면과 기록이 조용히 갈린다).
          (() => {
            const n = Number(String(extra.units ?? "").replace(",", "."));
            return !Number.isFinite(n) || n === 1 ? null : n;
          })()
        : autoOnInsert
          ? (row?.attendanceAutoUnits ?? null)
          : undefined;
    applyAttendanceLocal(
      studentId,
      classId,
      status,
      {
        ...(status === null ? { note: null, units: null } : {}),
        ...(extra && "note" in extra ? { note: extra.note ?? null } : {}),
        ...(optimisticUnits !== undefined ? { units: optimisticUnits } : {}),
      },
    );
    try {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate: activeDate,
        status,
        ...(extra && "note" in extra ? { note: extra.note ?? null } : {}),
        ...(extra && "units" in extra ? { units: extra.units } : {}),
        // 🔴 화면이 "기록 없음"이라 믿는 첫 체크만 비파괴로 — 서버에 이미 기록이 있으면(스테일 화면:
        //    데스크가 그 사이 결석을 찍음) 덮지 않고 conflict로 현재 상태를 받는다(2026-08-17 감사 P0-1).
        //    화면에 상태가 보이는 행의 변경(정정)은 종전대로 덮는다 — 그건 보고 하는 편집이다.
        //    보강 흐름은 opts.overwrite로 이 보호를 끈다(위 opts 주석 — 성공 안내와 기록이 갈리는 것 방지).
        onlyIfEmpty: status !== null && prev.raw === null && !opts?.overwrite,
        // 수업 나누기로 온 학생(0351a)은 이 반 수강행이 없다 — 보강 추가와 같은 문으로 연다(받는 반 = 출결 몫).
        ...(row?.splitIn ? { allowMakeup: true } : {}),
      });
      if ("error" in res) {
        rollbackAttendance(studentId, classId, prev);
        toast.error(res.error);
      } else if (res.conflict) {
        // 서버 진실로 화면을 맞춘다(낙관값 폐기) — 다시 누르면 그때는 보이는 상태를 바꾸는 정상 편집.
        const cu =
          res.conflict.units == null ? null : Number(String(res.conflict.units).replace(",", "."));
        applyAttendanceLocal(studentId, classId, res.conflict.status, {
          note: res.conflict.note,
          units: cu != null && Number.isFinite(cu) && cu !== 1 ? cu : null,
        });
        toast.message(
          tf("os.c.attConflict", {
            // 🔴 서버가 돌려준 raw 상태라 표에 없는 값일 수 있다 — 옛 `?? "기록됨"` 폴백을 그대로 지킨다.
            status: STATUS_TEXT[res.conflict.status as keyof typeof STATUS_TEXT]
              ? statusTextOf(res.conflict.status as keyof typeof STATUS_TEXT, lang)
              : t("os.c.attRecorded"),
          }),
        );
      } else if (autoOnInsert && res.autoUnits !== undefined) {
        // 서버가 실제로 넣은 시수로 맞춘다(자동값 또는 조회 실패 시 null=1) — 낙관값이 기록과 갈리지 않게.
        applyAttendanceLocal(studentId, classId, status, { units: res.autoUnits });
      }
    } catch {
      rollbackAttendance(studentId, classId, prev);
      toast.error(t("os.c.attFail"));
    } finally {
      setAttPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }
  /**
   * '일괄 출석'(빠른 출결, 원장 2026-08-18) — 지금 보이는 목록에서 **출결 기록이 없는 칸만** 출석으로
   * 찍는다. ⚠️ 두 모드의 **자리는 다르다**(표 모드=표 머리글 `학생 · 반` 칸 / 카드 모드=좌측 학생
   * 목록 머리 `학생 · 반별` 줄 — 좌측 목록은 카드 모드에서만 렌더된다). 대신 재료(`bulkPresentProps`)와
   * 이 핸들러를 **한 벌만** 두어 두 화면이 같은 수를 말하고 같은 칸을 보낸다.
   *
   * 🔴 **비파괴는 서버가 강제한다**(`fillEmptyOnly: true`) — 원스크린은 출결을 재폴링하지 않아, 열어 둔
   *    사이 데스크가 찍은 결석을 낡은 화면이 '출석'으로 뒤집을 수 있다(2026-08-17 감사 P0-1). 클라 계산
   *    (planQuickPresent)은 **라벨의 숫자와 요청 범위**만 정하고, 실제 "이미 기록 있음" 판정은 서버가 한다.
   * ⚠️ 셀 액션(setAttendanceCell)을 N번 부르지 않는다 — 반 하나가 30~40칸이라 왕복이 그만큼 늘어
   *    반응속도(1순위)를 깎는다. 게이트(권한·수정 기간·담당 반·수강생)는 배치 액션이 **집합 단위로**
   *    똑같이 강제한다(#77 — 화면이 아니라 액션이 게이트). ECS 오늘 보드 일괄과 같은 경로다.
   * ⚠️ 화면은 **서버가 실제로 기록한 칸(applied)만** 칠한다 — 게이트·기존 기록에 걸려 빠진 칸을
   *    '됐다'고 칠하면 화면과 출석부가 갈린다(표뷰 일괄과 같은 계약, 낙관 롤백 레이스도 없다).
   * ⚠️ 찍은 뒤 지각·결석으로 바꾸는 길은 알약에 그대로 열려 있다(원장: "추후에 지각 결석으로 변경 가능하게").
   */
  async function applyQuickPresent() {
    if (readonlyBlocked()) return;
    if (quickAttBusy) return;
    const { cells } = planQuickPresent(visible, activeClassFilter);
    if (cells.length === 0) return; // 버튼이 이미 비활성 — 방어선
    // 휴원일에만 한 번 묻는다(원장 2026-10-13 — 10/9 한글날 19명). 평소엔 확인창 없이 한 번에(버튼 주석의 결정 그대로).
    if (holidayName && !window.confirm(tf("os.present.holidayConfirm", { name: holidayName, n: cells.length }))) return;
    const keys = cells.map((c) => `${c.studentId}::${c.classId}`);
    setQuickAttBusy(true);
    setAttPending((p) => {
      const n = new Set(p);
      keys.forEach((k) => n.add(k));
      return n;
    });
    try {
      const res = await setAttendanceBulk({
        sessionDate: activeDate,
        status: "present",
        cells,
        fillEmptyOnly: true,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      // 새로 만든 칸엔 서버가 넣은 시수(수학 자동 시수, 없으면 null=1)를 그대로 — 화면 '타임'이 기록과 같게.
      for (const c of res.applied)
        applyAttendanceLocal(c.studentId, c.classId, "present", c.created ? { units: c.autoUnits ?? null } : undefined);
      const missed = cells.length - res.applied.length;
      if (res.applied.length === 0) {
        // 조용한 0건 금지 — 왜 아무 일도 안 났는지 밝힌다.
        toast.message(
          t("os.c.presentNone"),
        );
        return;
      }
      toast.success(
        tf("os.c.presentDone", { n: res.applied.length }) +
          (missed > 0 ? tf("os.c.presentMissed", { n: missed }) : ""),
      );
    } catch {
      toast.error(t("os.c.presentFail"));
    } finally {
      setAttPending((p) => {
        const n = new Set(p);
        keys.forEach((k) => n.delete(k));
        return n;
      });
      setQuickAttBusy(false);
    }
  }
  /**
   * 행(수업) 단위 평가값 갱신 — 태도·점수·과제 수행률·특이사항.
   *
   * 🔴 **그 행에만** 쓴다(원장 2026-08-13: *"보강은 정규와 완전히 다른 보고서"*). 학생 값(`student.attitude` 등)은
   *    건드리지 않는다 — 건드리면 아직 값이 없는 다른 행이 폴백으로 그 값을 따라가 버려서 버그가 그대로 재현된다.
   * 편집하는 행에는 먼저 `seedRowFields`로 **지금 화면에 보이던 값**을 굳힌다(안 그러면 태도만 바꿨는데
   * 점수가 미지정으로 남아 나중에 학생 값이 흔들릴 때 같이 흔들린다).
   * ⚠️ 대상 행을 못 찾으면 아무것도 안 한다 — 예전처럼 학생 값으로 흘리지 말 것.
   */
  function patchRowEval(studentId: string, subjectName: string, up: (su: Subject) => Subject) {
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? up(seedRowFields(s, su)) : su)),
    }));
  }
  // 표=SET(선택값), 카드=TOGGLE(같은 값 재클릭 시 해제) — 카드 wrapper가 토글을 계산해 SET 호출.
  function setAttitudeValue(studentId: string, subjectName: string, a: string | null) {
    wt(studentId, subjectName, "attitude");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, attitude: a }));
  }
  function setHomeworkValue(studentId: string, subjectName: string, h: string) {
    wt(studentId, subjectName, "homework");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, homework: h }));
  }
  // 소단원별 이해도(수학 보고서 시범, math-report-pilot.ts) — 행별. 자동저장(세션)에 실린다.
  function patchUnderstandingFor(studentId: string, subjectName: string, up: (st: UnderstandingState) => UnderstandingState) {
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, understanding: up(su.understanding ?? EMPTY_UNDERSTANDING) } : su)),
    }));
  }
  function setUnderstandingScoreFor(studentId: string, subjectName: string, lesson: string, score: number | null) {
    wt(studentId, subjectName, "understanding");
    patchUnderstandingFor(studentId, subjectName, (st) => {
      const scores = { ...st.scores };
      if (score == null) delete scores[lesson];
      else scores[lesson] = score;
      return { ...st, scores };
    });
  }
  // 일일 테스트 있음/없음 + 사유(수학 보고서 시범). '없음'으로 바꾸면 점수를 비운다 — 안 비우면 치지 않은 시험 점수가 저장·추세로 나간다.
  function setTestSkipFor(studentId: string, subjectName: string, skip: DailyTestSkip | null) {
    wt(studentId, subjectName, "dailyTest");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, dailyTestSkip: skip, ...(skip ? { dailyScore: null } : {}) }));
  }
  // 숙제 미제출 사유(수학 보고서 시범, 원장 2026-10-23 *"미제출일경우 사유작성"*) — 숙제 완성도 항목에 그대로 들어간다.
  function setAttitudeNoteFor(studentId: string, subjectName: string, note: string) {
    wt(studentId, subjectName, "attitude");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, attitudeNote: note }));
  }
  // '오늘의 수업' 메모(새 수학 보고서, 원장 2026-10-28) — 그날 한 일을 선생님이 짧게 적으면 AI가 '오늘의 수업'에 녹여 쓴다.
  function setLessonMemoFor(studentId: string, subjectName: string, memo: string) {
    wt(studentId, subjectName, "understanding");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, lessonMemo: memo }));
  }
  function setMakeupReasonFor(studentId: string, subjectName: string, reason: string) {
    wt(studentId, subjectName, "makeup");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, makeupReason: reason }));
  }
  function setHomeworkMissReasonFor(studentId: string, subjectName: string, reason: string) {
    wt(studentId, subjectName, "homework");
    patchRowEval(studentId, subjectName, (su) => ({ ...su, homeworkMissReason: reason }));
  }
  // 이해도 단계 버튼·일괄 입력(원장 2026-10-26) — 그 행 오늘 진도의 소단원 전부에 같은 점수.
  //   진도는 patch 안의 **그 행 값**에서 읽는다 — 일괄 입력이 같은 차례에 진도를 바꿔도(setProgressFor 직후) 새 차시에 맞춰 채운다.
  function setAllUnderstandingFor(studentId: string, subjectName: string, score: number) {
    wt(studentId, subjectName, "understanding");
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) =>
        su.name === subjectName ? { ...su, understanding: setAllUnderstanding(su.today, su.understanding ?? EMPTY_UNDERSTANDING, score) } : su,
      ),
    }));
  }
  function toggleUnderstandingFor(studentId: string, subjectName: string, lesson: string, off: boolean) {
    wt(studentId, subjectName, "understanding");
    patchUnderstandingFor(studentId, subjectName, (st) => ({
      ...st,
      off: off ? [...st.off.filter((l) => l !== lesson), lesson] : st.off.filter((l) => l !== lesson),
    }));
  }
  // 특이사항(강사 메모) — AI 멘트 입력(공지 모드 A/B). **행별**(보강은 다른 수업이라 메모도 다르다).
  function setNoteFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "note");
    // 수학 보고서 시범 — 칸 이름이 '강사 한줄 멘트(필수)'다. 자동작성 글 맨 끝의 옛 멘트를 그 자리에서 새 멘트로
    // 바꿔 끼운다(원장 2026-10-22 *"자동 작성 후 치면 실시간으로 우측에 반영"*). 바꾸기 전 값을 먼저 읽어 둔다.
    const st = studentsRef.current.find((x) => x.id === studentId);
    const row = st?.subjects.find((su) => su.name === subjectName);
    const pilotPrevNote = st && row && isMathReportPilot(studentId, row.subjectKey) ? resolveRowFields(st, row).note : null;
    patchRowEval(studentId, subjectName, (su) => ({ ...su, note: text }));
    if (pilotPrevNote === null) return;
    const rep = reportsRef.current[studentId]?.[subjectName];
    if (!rep || pilotRecomposeNote(rep.draft, rep.autoDraft, pilotPrevNote, text) === null) return;
    // 자동작성 글 그대로면 둘 다 같은 값으로 두어 작성 방식은 계속 '자동'이다(한줄 멘트는 AI가 아니라 강사 원문).
    // 강사가 고친 글이면 자동작성 원문(autoDraft)도 끝만 따로 바꿔 '자동작성 후 수정' 관계를 그대로 둔다(2026-10-23 수정 허용).
    // 실제 글은 갱신 함수 안에서 **최신 값**으로 다시 만든다(ref는 한 렌더 늦을 수 있다 — 방금 도착한 자동작성 글을 덮지 않게).
    patchReport(studentId, subjectName, (r) => {
      const next = pilotRecomposeNote(r.draft, r.autoDraft, pilotPrevNote, text);
      if (next === null || next === r.draft) return r;
      const edited = !isPilotAutoWritten(r.draft, r.autoDraft);
      const nextAuto = edited ? (pilotRecomposeNote(r.autoDraft, r.autoDraft, pilotPrevNote, text) ?? r.autoDraft) : next;
      return { ...r, draft: next, autoDraft: nextAuto };
    });
  }
  /** 카드 뷰가 지금 보고 있는 행 — 카드엔 과목 선택 탭이 있어 대상이 명확하다(표와 같은 행 단위 규약). */
  const cardRowName = () => previewSubject?.name ?? null;
  function setNote(text: string) {
    const n = cardRowName();
    if (!selected || !n) return;
    setNoteFor(selected.id, n, text);
  }
  function setProgress(subjectIndex: number, today: string) {
    if (!selected) return;
    setProgressFor(selected.id, subjectIndex, today);
  }
  function setProgressMode(subjectIndex: number, mode: string | null) {
    if (!selected) return;
    setProgressModeFor(selected.id, subjectIndex, mode);
  }
  function setStudyGrade(grade: string) {
    if (!selected) return;
    setStudyGradeFor(selected.id, grade);
  }
  function setScore(which: "daily" | "check", v: number | null) {
    const n = cardRowName();
    if (!selected || !n) return;
    setScoreFor(selected.id, n, which, v);
  }
  function setMax(which: "daily" | "check", v: number) {
    const n = cardRowName();
    if (!selected || !n) return;
    setMaxFor(selected.id, n, which, v);
  }
  function setAttitude(a: string) {
    const n = cardRowName();
    if (!selected || !n) return;
    // 카드=TOGGLE(같은 값 재클릭 시 해제) — 판정 기준은 **그 행의 현재 값**(표=SET과 같은 규약).
    const cur = resolveRowFields(selected, previewSubject).attitude;
    setAttitudeValue(selected.id, n, cur === a ? null : a);
  }
  function setHomework(h: string) {
    const n = cardRowName();
    if (!selected || !n) return;
    const cur = resolveRowFields(selected, previewSubject).homework;
    setHomeworkValue(selected.id, n, cur === h ? "" : h);
  }
  function setDraftFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "draft");
    patchReport(studentId, subjectName, (r) => ({ ...r, draft: text }));
  }
  function setSubjectDraft(subjectName: string, text: string) {
    if (!selected) return;
    setDraftFor(selected.id, subjectName, text);
  }
  /** 행(학생·과목 이름) → 그 행의 반. 반이 없는 행(수업외 보강)은 null — '학습 추세 미발송' 키가 없다. */
  function rowClassId(studentId: string, subjectName: string): string | null {
    return students.find((x) => x.id === studentId)?.subjects.find((su) => su.name === subjectName)?.classId ?? null;
  }
  /** 이 행은 학습 추세를 안 보내는가(원장 2026-09-18) — 표·카드가 체크 표시에 쓴다. */
  function isTrendHiddenFor(studentId: string, subjectName: string): boolean {
    return isTrendOptedOut(trendOptOut, rowClassId(studentId, subjectName), studentId);
  }
  /**
   * '학습 추세 미발송' 켜고 끄기 — 화면은 **즉시**, 저장은 뒤에서(실패하면 되돌리고 알린다).
   * 🔴 ref도 이 자리에서 함께 바꾼다 — 체크하자마자 누른 [발송]이 effect 전 옛 값을 읽으면 끈 추세가 나간다.
   */
  function toggleTrendHiddenFor(studentId: string, subjectName: string) {
    if (readonlyView) return;
    const classId = rowClassId(studentId, subjectName);
    const key = trendOptOutKey(classId, studentId);
    if (!classId || !key) return;
    const on = !trendOptOut.has(key);
    const flip = (base: ReadonlySet<string>, turnOn: boolean) => {
      const next = new Set(base);
      if (turnOn) next.add(key);
      else next.delete(key);
      return next;
    };
    const next = flip(trendOptOut, on);
    trendOptOutRef.current = next;
    setTrendOptOut(next);
    void setMyTrendOptOut({ classId, studentId, on }).then(
      (res) => {
        if (res.ok) return;
        const back = flip(trendOptOutRef.current, !on);
        trendOptOutRef.current = back;
        setTrendOptOut(back);
        toast.error(res.error ?? t("os.row.trendOptOutFail"));
      },
      () => {
        const back = flip(trendOptOutRef.current, !on);
        trendOptOutRef.current = back;
        setTrendOptOut(back);
        toast.error(t("os.row.trendOptOutFail"));
      },
    );
  }
  // 학습 추세(종합분석) 초안 편집 — 멘트(draft)와 별개 필드(4a).
  function setTrendDraftFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "trend");
    patchReport(studentId, subjectName, (r) => ({ ...r, trendDraft: text }));
  }
  function setSubjectTrend(subjectName: string, text: string) {
    if (!selected) return;
    setTrendDraftFor(selected.id, subjectName, text);
  }
  // 교재명·보강 — 과목별(subjectName으로 해당 과목만 갱신). 자동저장(patch→queueSave)에 실림.
  function setTextbookFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "textbook");
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, textbook: text } : su)),
    }));
  }
  function setTextbook(subjectName: string, text: string) {
    if (!selected) return;
    setTextbookFor(selected.id, subjectName, text);
  }
  function toggleMakeupFor(studentId: string, subjectName: string) {
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, makeup: !su.makeup } : su)),
    }));
  }
  function toggleMakeup(subjectName: string) {
    if (!selected) return;
    toggleMakeupFor(selected.id, subjectName);
  }
  /** 그 줄 보고서를 보냈거나 보내는 중인가 — '보강 빼기'와 같은 판정(canRemoveMakeupRow) + 발송 표시. */
  const reportLockedOf = (studentId: string) => (rowName: string) => {
    const rep = reports[studentId]?.[rowName];
    return !!rep?.sent || !canRemoveMakeupRow(rep?.classnoteStatus ?? null);
  };
  function switchBlockText(reason: MakeupSwitchBlock, cls: string): string {
    return reason === "noRegular" || reason === "reservedDone" ? tf(SWITCH_BLOCK_KEY[reason], { cls }) : t(SWITCH_BLOCK_KEY[reason]);
  }
  /**
   * 분리 → 합침(원장 2026-10-22 *"보강으로 분리되어있는 보고서도 … 같이 보내고 싶을 수"*) — 보강 줄을 **같은 반** 정규 줄에 합친다(makeup-switch.ts).
   * 🔴 하루 정규 2회여도 추측하지 않는다(앵커 반의 정규 줄 하나) · 시수는 그대로(같은 반 칸에 이미 있다 — 출결은 지우지 않는다).
   * 🔴 예약에서 온 보강이면 예약을 먼저 '합침'으로 바꾼다 — 안 바꾸면 새로고침이 예약대로 '(보강)' 줄을 다시 세운다. 뒤가 실패하면 되돌린다.
   * 🔑 앵커 반에 오늘 정규 줄이 없는 **예약** 보강은 오늘 같은 과목 정규 반으로 **예약을 옮겨** 합친다(원장 2026-10-27 박지호 건 — `move`).
   *    정규 반이 둘 이상이면 강사가 고른다. 시수는 서버가 옮긴 반에서 이행한다(출석이 이미 찍혔으면 지금). 옮긴 뒤 보강 줄 정리가 실패하면
   *    예약은 되돌리지 않고 알린다(새로고침하면 옮긴 반 '정규+보강'으로 선다 — 그게 고른 결과다).
   */
  async function joinMakeupRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked() || makeupSaving) return;
    const card = studentsRef.current.find((s) => s.id === student.id);
    if (!card) return;
    const src0 = card.subjects.find((x) => x.name === subjectName);
    const anchorName = src0?.makeupClassName ?? todayClasses.find((c) => c.id === src0?.makeupClassId)?.name ?? t("os.switch.otherClass");
    const classNameOf = (row: Subject) => row.className ?? todayClasses.find((c) => c.id === row.classId)?.name ?? row.name;
    let plan = planJoinMakeup(card, subjectName, reportLockedOf(card.id));
    if (!plan.ok && plan.reason === "pickRegular") {
      // 옮겨 합칠 정규 반이 둘 이상 — 추측하지 않고 고르게 한다(번호).
      const choices = plan.choices;
      const answer = window.prompt(tf("os.switch.pickRegular", { list: choices.map((c, i) => `${i + 1}. ${classNameOf(c)}`).join("\n") }), "1");
      if (answer === null) return;
      const picked = choices[Number(answer.trim()) - 1];
      if (!picked?.classId) {
        toast.error(t("os.switch.pickRegularBad"));
        return;
      }
      plan = planJoinMakeup(card, subjectName, reportLockedOf(card.id), picked.classId);
    }
    if (!plan.ok) {
      toast.error(plan.reason === "pickRegular" ? t("os.switch.blockGone") : switchBlockText(plan.reason, anchorName));
      return;
    }
    const { source, target, move } = plan;
    const cls = classNameOf(target);
    const ask = move ? tf("os.switch.confirmMove", { name: card.name, from: anchorName, cls }) : tf("os.switch.confirmJoin", { name: card.name, cls });
    if (!window.confirm(ask)) return;
    setMakeupSaving(true);
    try {
      const reserved = !!source.makeupReserved?.length;
      let movedUnits: number | null | undefined;
      if (move) {
        const r = await moveReservationToRegular({ studentId: card.id, date: activeDate, fromClassId: source.makeupClassId!, toClassId: target.classId! });
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        movedUnits = r.units;
      } else if (reserved) {
        const r = await setReservationReportMode({ studentId: card.id, classId: target.classId!, date: activeDate, mode: "merge" });
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
      }
      // 보강 줄의 명단·미발송 보고서만 지운다 — 출결은 그대로(classId null). 예약에서 막 선 줄은 지울 기록이 없을 수 있다(not_found = 정상).
      const res = await removeMakeupEntry({ studentId: card.id, date: activeDate, classId: null, subject: source.subjectKey ?? null });
      if (!res.ok && !(reserved && res.code === "not_found")) {
        if (move) {
          toast.error(tf("os.switch.movedRowLeft", { cls, error: res.error }));
          return;
        }
        if (reserved) await setReservationReportMode({ studentId: card.id, classId: target.classId!, date: activeDate, mode: "separate" }).catch(() => null);
        toast.error(res.error);
        return;
      }
      const joined = joinMakeupContent(target, source, card.note ?? "");
      // 옮겨 합치면 두 반의 예약이 다르다 — 정규 반에 원래 있던 예약은 제 방식 그대로 두고 옮긴 예약만 '합침'으로 잇는다(리뷰 2026-10-27).
      const reservedList = move
        ? [...(target.makeupReserved ?? []), ...(source.makeupReserved ?? []).map((r) => ({ ...r, mode: "merge" as const }))]
        : (target.makeupReserved ?? source.makeupReserved)?.map((r) => ({ ...r, mode: "merge" as const }));
      patch(card.id, (s) => ({
        ...s,
        subjects: s.subjects
          .filter((x) => x.name !== source.name)
          .map((x) => (x.name === target.name
            ? {
                ...x, ...joined, makeup: true,
                ...(reserved ? { makeupByReservation: true as const, ...(reservedList ? { makeupReserved: reservedList } : {}) } : {}),
                // 옮긴 반에서 지금 이행됐으면(출석이 이미 찍힘) 서버가 맞춘 시수 — 화면 '타임'도 그 값으로.
                ...(movedUnits !== undefined ? { attendanceUnits: movedUnits } : {}),
              }
            : x)),
      }));
      // 멘트 초안도 잇는다(보고서 칸은 줄 이름으로 묶인다) — 보강 줄 칸은 지운다.
      setReports((prev) => {
        const mine = { ...(prev[card.id] ?? {}) };
        const into = mine[target.name];
        const from = mine[source.name];
        if (into) mine[target.name] = { ...into, draft: joinText(into.draft, from?.draft, "\n\n") };
        delete mine[source.name];
        return { ...prev, [card.id]: mine };
      });
      setSelId(card.id);
      toast.success(tf(move ? "os.switch.moved" : "os.switch.joined", { name: card.name, cls }));
    } catch {
      toast.error(t("os.c.makeupSaveFail"));
    } finally {
      setMakeupSaving(false);
    }
  }
  /**
   * 합침 → 분리(원장 2026-10-22) — '정규+보강' 줄을 정규로 되돌리고 같은 반에 앵커를 둔 빈 '(보강)' 줄을 세운다.
   * 🔴 출결 칸은 세우지 않는다(`recordCell: false` — 같은 반 칸에 시수가 이미 있다). 합친 보고서의 글은 나누지 못한다(새 보강 줄은 비어 있다 — 확인창이 알린다).
   */
  async function splitMakeupRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked() || makeupSaving) return;
    const card = studentsRef.current.find((s) => s.id === student.id);
    if (!card) return;
    const plan = planSplitMakeup(card, subjectName, reportLockedOf(card.id));
    if (!plan.ok) {
      toast.error(switchBlockText(plan.reason, ""));
      return;
    }
    const { row } = plan;
    const cls = row.className ?? todayClasses.find((c) => c.id === row.classId)?.name ?? row.name;
    if (!window.confirm(tf("os.switch.confirmSplit", { name: card.name, cls }))) return;
    setMakeupSaving(true);
    try {
      const reserved = !!row.makeupReserved?.length;
      if (reserved) {
        const r = await setReservationReportMode({ studentId: card.id, classId: row.classId!, date: activeDate, mode: "separate" });
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
      }
      const result = await registerMakeupEntries({
        studentId: card.id, date: activeDate,
        entries: [{ subject: row.subjectKey || row.name, makeupClassId: row.classId, recordCell: false }],
      });
      if (!result.ok) {
        if (reserved) await setReservationReportMode({ studentId: card.id, classId: row.classId!, date: activeDate, mode: "merge" }).catch(() => null);
        toast.error(result.error);
        return;
      }
      if ((card.sessionUpdatedAt ?? null) === result.previousUpdatedAt) applySessionSaveResult(card.id, result);
      const used = new Set(card.subjects.map((x) => x.name));
      const base = row.subjectLabel ?? row.name;
      let name = makeupRowName(base);
      for (let n = 2; used.has(name); n++) name = makeupRowName(base, n);
      const reservedList = row.makeupReserved?.map((r) => ({ ...r, mode: "separate" as const }));
      const added: Subject = {
        name, subjectLabel: base, subjectKey: row.subjectKey, classId: null, makeup: true,
        makeupClassId: row.classId, makeupClassName: cls,
        ...(reservedList ? { makeupReserved: reservedList } : {}),
        prev: "", today: "", textbook: "", homeworkToday: "",
      };
      patch(card.id, (s) => ({
        ...s,
        subjects: [
          ...s.subjects.map((x) => {
            if (x.name !== row.name) return x;
            const { makeupByReservation: _drop, ...rest } = x;
            void _drop;
            return { ...rest, makeup: false, ...(reservedList ? { makeupReserved: reservedList } : {}) };
          }),
          added,
        ],
      }));
      const slots = initReports([{ ...card, subjects: [added] }], templatePrefsRef.current)[card.id] ?? {};
      setReports((prev) => ({ ...prev, [card.id]: { ...(prev[card.id] ?? {}), ...slots } }));
      setSelId(card.id);
      toast.success(tf("os.switch.splitDone", { name: card.name }));
    } catch {
      toast.error(t("os.c.makeupSaveFail"));
    } finally {
      setMakeupSaving(false);
    }
  }
  /**
   * **보강 진행 여부 확인**(원장 2026-10-27 *"보강 예약을 누르면 보강을 했다 안했다 체크"*) — 보강 예약 표식의 '보강 했음 / 보강 못 했음'.
   * 대상 반 = 정규+보강 줄의 반 · '(보강)' 줄의 앵커 반(예약이 기록된 반). 서버 [`checkMakeupReservation`]:
   *  · 했음 = 아직 이행 전이면 이행(시수) + 확인 → 표식 '보강 완료' · 발송 게이트가 풀린다.
   *  · 못 했음 = 보강분 시수를 빼고 예약을 지운다 → 정규 줄은 예약 합침이면 정규로, 그 반의 '(보강)' 줄은 화면에서 빼고 그 줄의 명단·
   *    미발송 보강 보고서도 '보강 빼기'와 같은 길로 지운다(남기면 새로고침 뒤 확인 게이트 없이 다시 서서 보내진다 — 적대 리뷰 2026-10-27).
   *    로스터는 마운트 때 한 번 복사돼 새로고침 없이는 안 바뀐다.
   *  · 했음인데 그날 칸이 없어 서버가 찍었으면(`marked`) 출결 알약도 그 값으로 맞춘다(출석부 스트립 반영과 같은 함수).
   */
  async function checkMakeup(student: OneScreenStudent, subjectName: string, outcome: "done" | "missed") {
    if (readonlyBlocked() || makeupSaving) return;
    const card = studentsRef.current.find((s) => s.id === student.id);
    const row = card?.subjects.find((x) => x.name === subjectName);
    const classId = row ? (row.classId ?? row.makeupClassId ?? null) : null;
    if (!card || !row || !classId || !row.makeupReserved?.length) {
      toast.error(t("os.switch.blockGone"));
      return;
    }
    if (outcome === "missed" && !window.confirm(tf("os.reserved.confirmMissed", { name: card.name }))) return;
    setMakeupSaving(true);
    try {
      // 못 했음이면 그 반 '(보강)' 줄의 명단·미발송 보고서를 지운다(없으면 not_found = 정상) — 실패해도 예약은 이미 지워졌으니 알리기만.
      // 🔴 예약이 그 줄을 세웠을 때만(분리 — 정규 수업일이 아니면 늘 분리) — 모두 합침이면 그 반 '(보강)' 줄은 '+ 보강 학생 추가'로 따로 세운
      //    실제 보강이라 지우지 않는다(적대 리뷰 2026-10-27).
      const ownRow = row.makeupReserved.some((m) => m.mode === "separate");
      const pureRows = ownRow ? card.subjects.filter((x) => x.makeup && !x.classId && x.makeupClassId === classId) : [];
      let r = await checkMakeupReservation({ studentId: card.id, classId, date: activeDate, outcome });
      // 정규 수업이 없는 날의 보강 칸이 남았다(`makeup_only`) — 그 '(보강)' 줄을 '보강 빼기'와 같은 길로 칸째 지우고(보강 칸·명단·미발송
      // 보고서) 다시 묻는다. 칸이 없어진 예약은 서버가 시수 없이 지운다. '보강 빼기'가 막히면(남이 연 칸·발송된 보고서) 그 사유를 보인다.
      // 🔴 칸이 실제로 지워졌을 때만 다시 묻는다 — 강사는 본인이 찍은 '보강' 칸만 지워지고 '출석'으로 찍힌 칸은 안 지워진다(그때는 서버 안내로
      //    멈춘다 · 재리뷰). 두 번째 요청이 실패해도 줄은 화면에 남아 바로 다시 누를 수 있다(새로고침하면 비정규일 이행 예약은 표식이 안 선다).
      let removedFirst = false;
      if ("error" in r && r.code === "makeup_only" && pureRows.length) {
        let cellGone = false;
        for (const x of pureRows) {
          const rm = await removeMakeupEntry({ studentId: card.id, date: activeDate, classId, subject: x.subjectKey ?? null });
          if (!rm.ok && rm.code !== "not_found") {
            toast.error(rm.error);
            return;
          }
          if (rm.ok && rm.attendanceRemoved) cellGone = true;
        }
        if (!cellGone) {
          toast.error(r.error);
          return;
        }
        removedFirst = true;
        r = await checkMakeupReservation({ studentId: card.id, classId, date: activeDate, outcome });
      }
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      if (outcome === "missed" && !removedFirst) {
        for (const x of pureRows) {
          const rm = await removeMakeupEntry({ studentId: card.id, date: activeDate, classId: null, subject: x.subjectKey ?? null }).catch(() => null);
          if (rm && !rm.ok && rm.code !== "not_found") toast.error(rm.error);
        }
      }
      const onClass = (x: Subject) => (x.classId ?? x.makeupClassId ?? null) === classId && !!x.makeupReserved?.length;
      const unitsPatch = r.units !== undefined ? { attendanceUnits: r.units } : {};
      const dropped = outcome === "missed" ? pureRows.map((x) => x.name) : [];
      patch(card.id, (s) => ({
        ...s,
        subjects: s.subjects
          .filter((x) => !dropped.includes(x.name))
          .map((x) => {
            if (!onClass(x)) return x;
            if (outcome === "done") {
              return {
                ...x,
                makeupReserved: x.makeupReserved!.map((m) => ({ ...m, done: true, ...(r.checkUnsaved ? {} : { checked: true }) })),
                ...(x.classId === classId ? unitsPatch : {}),
              };
            }
            const { makeupReserved: _gone, makeupByReservation, ...rest } = x;
            void _gone;
            return { ...rest, ...(makeupByReservation ? { makeup: false } : {}), ...(x.classId === classId ? unitsPatch : {}) };
          }),
      }));
      if (dropped.length) {
        setReports((prev) => {
          const mine = { ...(prev[card.id] ?? {}) };
          for (const name of dropped) delete mine[name];
          return { ...prev, [card.id]: mine };
        });
      }
      if (r.marked) {
        const cells = [{ studentId: card.id, classId, ...(r.units !== undefined ? { units: r.units } : {}) }];
        setStudents((prev) => applyAppliedAttendance(prev, cells, r.marked!, attPendingRef.current));
      }
      toast.success(tf(outcome === "done" ? "os.reserved.checkedDone" : "os.reserved.checkedMissed", { name: card.name }));
      if (r.unitsLeft) toast.message(t("os.reserved.unitsLeft"));
    } catch {
      toast.error(t("os.c.makeupSaveFail"));
    } finally {
      setMakeupSaving(false);
    }
  }
  // 오늘 영상 과제 있음/없음(0308a) — 과목(행)별. 자동저장에 실린다(보강 토글과 같은 길).
  function toggleVideoHomeworkFor(studentId: string, subjectName: string) {
    patch(studentId, (s) => ({
      ...s,
      // 영상 과제를 끄면 링크 넣기도 함께 끈다(토글이 사라지는데 값만 켜진 채 남지 않게). 고른 적 없는 행은 그대로 둔다.
      // 마감도 7일로 돌린다 — 끈 채 저장하면 서버가 마감을 지운다. 다시 켜면 7일에서 시작한다(옛 '다음 수업' 날짜가 남지 않게, 적대 리뷰 L3).
      subjects: s.subjects.map((su) => (su.name === subjectName
        ? { ...su, videoHomework: !su.videoHomework, ...(su.videoHomework && su.videoSubmitLink ? { videoSubmitLink: false } : {}),
          ...(su.videoHomework && su.videoHomeworkDue ? { videoHomeworkDue: "week" as const, videoHomeworkDueDate: undefined } : {}),
          // 새로 켜면 내 기본 마감으로 시작한다(원장 2026-10-28, due-pref.ts) — 옛 '다음 수업' 날짜는 남기지 않는다(L3).
          ...(!su.videoHomework && videoDueDefaultRef.current === "next" ? { videoHomeworkDue: "next" as const, videoHomeworkDueDate: undefined } : {}) }
        : su)),
    }));
  }
  // 영상 첨부 링크 넣기(0328a, 원장 2026-10-02) — 행별. '영상 과제'를 켠 행에서만 토글이 뜬다. 자동저장에 실린다.
  function toggleVideoSubmitLinkFor(studentId: string, subjectName: string) {
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, videoSubmitLink: !su.videoSubmitLink } : su)),
    }));
  }
  // 영상 숙제 마감(원장 2026-10-15) — 행별 7일 · 다음 수업. '영상 과제'를 켠 행에서만 토글이 뜬다. 자동저장에 실린다.
  function setVideoHomeworkDueFor(studentId: string, subjectName: string, mode: "week" | "next") {
    wt(studentId, subjectName, "homeworkToday");
    rememberVideoDue(mode);
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, videoHomeworkDue: mode } : su)),
    }));
  }
  function setVideoHomeworkDue(subjectName: string, mode: "week" | "next") {
    if (!selected) return;
    setVideoHomeworkDueFor(selected.id, subjectName, mode);
  }
  function toggleVideoSubmitLink(subjectName: string) {
    if (!selected) return;
    toggleVideoSubmitLinkFor(selected.id, subjectName);
  }
  function toggleVideoHomework(subjectName: string) {
    if (!selected) return;
    toggleVideoHomeworkFor(selected.id, subjectName);
  }
  // 오늘 과제(숙제 내용) — 과목별(0096a). 자동저장에 실리고 AI 멘트·학부모 카드 재료.
  function setHomeworkTodayFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "homeworkToday");
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => (su.name === subjectName ? { ...su, homeworkToday: text } : su)),
    }));
  }
  function setHomeworkToday(subjectName: string, text: string) {
    if (!selected) return;
    setHomeworkTodayFor(selected.id, subjectName, text);
  }
  /**
   * ECS 시트 값으로 진도·교재·오늘 과제를 되채운다(2026-08-07).
   * ⚠️ **비어 있는 항목은 건드리지 않는다** — 시트에 과제가 없다고 강사가 손으로 쓴 과제를 지우면 안 된다.
   *    학생별 기록(`sheetStudentNote`)은 대상이 아니다(개인 메모 자동 삽입 금지).
   */
  function applySheetDraft(subjectIndex: number) {
    return withWriteOrigin("prev", () => applySheetDraftInner(subjectIndex));
  }
  function applySheetDraftInner(subjectIndex: number) {
    if (!selected) return;
    const su = selected.subjects[subjectIndex];
    const sheet = su?.sheetDraft;
    if (!su || !sheet) return;
    if (sheet.progress) setProgressFor(selected.id, subjectIndex, sheet.progress);
    if (sheet.textbook) setTextbookFor(selected.id, su.name, sheet.textbook);
    if (sheet.homework) setHomeworkTodayFor(selected.id, su.name, sheet.homework);
  }
  // ── 영어 템플릿 모드(2026-09-10) — 영어 행은 멘트 대신 **템플릿 글**을 만든다(수학 경로 불변) ──
  // 조립·판정은 english-draft.ts(순수·Vitest)가 한다 — 여기선 칸 값을 모으고 결과를 행에 쓴다.
  /**
   * 이 행이 고른 템플릿. 없거나 지워졌으면 **null** — 호출부가 기본 템플릿으로 채우되 그 사실을 알린다
   * (말없이 다른 템플릿으로 바꿔 끼우면 강사가 고른 것과 다른 글이 나간다, 적대 리뷰 2026-09-10).
   * ⚠️ 비동기 경로(자동작성·저장·복사)는 `englishTemplatesRef.current`를 넘긴다 — 일괄 작성 중 도착한 목록도 본다.
   */
  function findTemplate(
    templateId: string | undefined,
    list: readonly ReportTemplate[] = englishTemplates,
  ): ReportTemplate | null {
    return findTemplateIn(list, templateId, DEFAULT_ENGLISH_TEMPLATE);
  }
  /**
   * 영어 행의 사실 — 표시 필드는 저장(buildReportFields)과 **같은 함수**로 만들고(오늘 과제 쪽수 후보정·테스트 표기)
   * 평가값은 행 단위(row-fields.ts)로 읽는다. 템플릿 글과 AI 지문이 모두 이 값에서 나온다.
   */
  function englishFactsOf(
    student: OneScreenStudent,
    su: Subject,
    // 그림 칸 판정의 기준 글(자동 글 → 지금 글) — 인재원 자료를 아직 모를 때 중립으로 두는 데 쓴다(slotFactsFor).
    rep?: SubjectReport,
    // 렌더는 state, 비동기 경로(저장 직전 재조립·자동작성)는 ref를 넘긴다(use-english-jj.ts).
    jjCache: JjDayCache = jj.cache,
  ): EnglishRowFacts {
    const rowEval = resolveRowFields(student, su);
    const fields = buildReportFields({
      subject: su,
      homework: rowEval.homework,
      attitude: rowEval.attitude,
      tests: rowEval.tests,
      draft: "",
      jjSheet: isJjSheetReport(rep),
      showDailyTest,
      showCheckTest,
    });
    return {
      studentName: student.name,
      teacherName,
      progress: su.today ?? "",
      progressMode: su.progressMode ?? null,
      homeworkToday: fields.homeworkToday,
      dailyTest: fields.dailyTest,
      checkTest: fields.checkTest,
      attitude: rowEval.attitude ?? "",
      homework: rowEval.homework,
      note: rowEval.note,
      // 출결(원장 2026-10-26) — 출석부 칸 그대로(수학 보고서와 같은 문장, attendance-sentence.ts).
      // 보강 줄이면 결석 날짜·시간·사유를 붙인다(2026-10-26 — 수학과 같은 재료, report-comment.ts rowMakeupFacts).
      attendance: attendanceSentence(su.attendanceRaw, su.attendanceNote, rowMakeupFacts(student, su)),
      // EiE 월간 보고서 점수(2026-11-05) — 로스터가 실어 둔 그 반 Monthly Test(english-monthly.ts).
      monthly: su.monthlyEval ?? null,
      slots: slotFactsFor(
        jjKnownSlots(jjCache[jjDayKey(student.id, activeDate)]),
        rep?.autoDraft ?? rep?.draft ?? "",
      ),
    };
  }
  /** 보강·수업외 행(담당 반 대신 같은 학원 학생) — 저장 입력과 인재원 조회가 같은 판정을 쓴다. */
  function rowOutOfClass(student: OneScreenStudent, su: Subject | undefined): boolean {
    return (student.isMakeup ?? false) || (!!su?.makeup && !su?.classId);
  }
  /** 패널 한 줄 요약 재료 — 아직 안 받았으면 '불러오는 중'(카드를 열면 곧 받는다). */
  function englishJjStatusOf(studentId: string): EnglishJjStatus {
    const key = jjDayKey(studentId, activeDate);
    const st = jj.cache[key];
    // 다시 받는 중이면 옛 요약 대신 '불러오는 중' — 다시 채우기·새로 고침을 눌렀는데 아무 일도 없어 보이지 않게(적대 리뷰).
    if (!st || jj.pending.has(key)) return { kind: "loading" };
    if (st.status === "unlinked") return { kind: "unlinked" };
    if (st.status === "error") return { kind: "error", detail: st.message };
    const sum = jjDaySummary(st);
    return { kind: "ok", exams: sum?.exams ?? 0, answers: sum?.answers ?? 0 };
  }
  /** 결과지 고르기 재료 — 받은 자료가 있을 때만. 받는 중이면 잠근다(옛 목록 위에서 고르기가 계산되지 않게). */
  function englishJjPickOf(studentId: string): JjExamPickState | null {
    const key = jjDayKey(studentId, activeDate);
    const st = jj.cache[key];
    if (st?.status !== "ok") return null;
    return {
      options: st.options ?? [],
      pick: st.snapshot.pick ?? null,
      date: activeDate,
      busy: jj.pending.has(key),
    };
  }
  /** 미리보기에 실을 인재원 자료(받은 것만) — 발송본은 저장 때 서버가 다시 받은 것으로 그린다. */
  function englishJjSnapshotOf(studentId: string) {
    const st = jj.cache[jjDayKey(studentId, activeDate)];
    return st?.status === "ok" ? st.snapshot : null;
  }
  /**
   * 미리보기에 실을 영어 글 — 템플릿 글 그대로면 **저장·복사 때 실제로 나갈 글**(지금 칸 값으로 다시 짠 글)을 보여 준다.
   * 렌더 중이라 상태는 바꾸지 않는다. 고친 글·가져온 글은 그대로("학부모가 받는 화면 그대로"가 거짓이 되지 않게).
   */
  function englishPreviewDraft(student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined): string {
    const found = findTemplate(rep?.templateId);
    if (!found || !canRecompose(found, rep)) return rep?.draft ?? "";
    // 강사가 넣은 사진·PDF 자리 줄은 다시 짠 글에도 그 자리에 따라온다(image-slots.ts carryAttachmentLines).
    return carryAttachmentLines(rep?.draft, composeEnglishDraft(found, englishFactsOf(student, su, rep), rep ?? {}));
  }
  /** 경고 셋(칸 달라짐·AI 코멘트가 옛 값 기준·이름 없음) — 카드 칸·표 행·발송 확인이 같은 판정을 쓴다. */
  function englishRowFlags(student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined) {
    const found = findTemplate(rep?.templateId);
    const template = found ?? DEFAULT_ENGLISH_TEMPLATE;
    const facts = englishFactsOf(student, su, rep);
    const aiStale = isAiStale(template, facts, rep);
    // 🔴 글이 옛 칸 값을 담고 있는데 저장·복사가 자동으로 못 맞추는가(템플릿 삭제·목록 실패·AI 글 없음·고친 글) —
    //    템플릿과 무관한 지문으로 판정한다(못 찾은 템플릿으로 판정하면 옛 점수가 경고 없이 나갔다, 적대 재리뷰).
    const textOutdated = isTextOutdated(found, facts, rep);
    return {
      stale: (!!found && isTemplateStale(found, facts, rep)) || textOutdated,
      aiStale,
      nameMissing: isNameMissing(template, rep, student.name),
      // 'AI 글 없음' = 글의 템플릿에 AI 칸이 새로 생겼거나(템플릿 편집) 고른 템플릿이 AI 글을 기다리는 중.
      // 템플릿을 못 찾았으면 판정하지 않는다(기본 템플릿으로 판정하면 거짓 칩이 선다) — 대신 '템플릿 없음'.
      needsAi:
        (!!found && needsAiFirst(found, rep)) ||
        pendingNeedsAi(rep?.pendingTemplateId ? findTemplate(rep.pendingTemplateId) : null, rep),
      // 글의 템플릿이 목록에서 사라졌다(삭제) — 목록을 제대로 받았을 때만 단정한다.
      templateGone: !!rep?.templateId && !found && templatesLoaded && !templateListFailed,
      // 내보내기(발송·저장·복사·링크) 전에 물을 조건 — 판정은 이것 하나. 강사가 같은 값에서 이미 '그대로'라고 답했으면
      // 다시 묻지 않는다(칩은 그대로 남는다 — 확인은 지문이 아니라 따로 적는다).
      outdated: (aiStale || textOutdated) && rep?.outputAck !== outputAckKey(rep, facts),
    };
  }
  /**
   * '그대로 보낼/저장할/복사할까요?'에 **예**라고 답했으면 그 값으로 확인된 것으로 **따로 적는다**(outputAck) — 같은 값인
   * 동안 같은 확인을 되풀이하지 않고, 값이 또 바뀌면 다시 묻는다(손으로 고친 글에 풀리지 않는 확인이 매번 떠 OK만 누르게
   * 됐다). 🔴 지문·칩은 건드리지 않는다(english-draft `outputAckKey`). 화면 메모리에만 둔다(새로 열면 다시 묻는다).
   */
  function acknowledgeEnglishOutput(student: OneScreenStudent, su: Subject) {
    const rep = reportsRef.current[student.id]?.[su.name];
    if (!rep) return;
    const ack = outputAckKey(rep, englishFactsOf(student, su, rep));
    patchReport(student.id, su.name, (r) => ({ ...r, outputAck: ack }));
  }
  /** 이 영어 행의 템플릿을 아직 확인할 수 없다(목록이 오는 중) — 곧 다시 짤 수 있게 되니 내보내기를 잠깐 미룬다. */
  function englishTemplateNotReady(rep: SubjectReport | undefined): boolean {
    return (
      !!rep?.templateId && !templatesLoadedRef.current && !findTemplate(rep.templateId, englishTemplatesRef.current)
    );
  }
  /**
   * 영어 행을 내보내기 전(발송·저장·복사) 한 번 묻는다 — 글이 고치기 전 값을 담고 있을 때만(`outdated`, 판정 하나).
   * 예라고 하면 확인된 것으로 친다. @returns 계속해도 되면 true
   */
  function confirmEnglishOutput(
    student: OneScreenStudent,
    su: Subject | undefined,
    key: "os.tpl.outdatedSend" | "os.tpl.outdatedSave" | "os.tpl.outdatedCopy",
  ): boolean {
    if (!su || su.subjectKey !== "english") return true;
    const rep = reportsRef.current[student.id]?.[su.name];
    // 목록이 아직 오는 중이면 잠깐 미룬다 — 곧 다시 짤 수 있게 되는데 지금 '그대로'를 권하면 옛 글이 나간다.
    if (englishTemplateNotReady(rep)) {
      toast.message(t("os.tpl.loading"));
      return false;
    }
    if (!englishRowFlags(student, su, rep).outdated) return true;
    if (!window.confirm(t(key))) return false;
    acknowledgeEnglishOutput(student, su);
    return true;
  }
  /** 일괄 작업 대상 중 글이 고치기 전 값을 담은 영어 행(확인 창에 이름을 적는다). */
  function outdatedEnglishRows<T extends { student: OneScreenStudent; subject: Subject }>(rows: readonly T[]): T[] {
    return rows.filter(
      (r) =>
        r.subject.subjectKey === "english" &&
        englishRowFlags(r.student, r.subject, reportsRef.current[r.student.id]?.[r.subject.name]).outdated,
    );
  }
  /**
   * 🔴 템플릿이 마지막으로 만든 글 **그대로**면 지금 칸 값으로 다시 조립한다(저장·복사 직전). 자동작성 뒤 점수·숙제를
   *    고치면 글만 옛 값으로 남아 학부모 카드(/r)·복사본이 기록과 다른 말을 했다(적대 리뷰 2026-09-10).
   *    판정은 **지문**(templateHash) — 고친 글·'이전 회차 가져오기'로 넣은 글·옛 세션 글은 건드리지 않는다
   *    (`draft === autoDraft`로 판정했더니 가져온 글이 저장 때 조용히 사라졌다, 적대 재리뷰 2026-09-10).
   */
  function freshEnglishDraft(
    student: OneScreenStudent,
    subjectName: string,
  ): { draft: string; autoDraft: string | undefined } {
    const rep = reportsRef.current[student.id]?.[subjectName];
    const draft = rep?.draft ?? "";
    const su = student.subjects.find((x) => x.name === subjectName);
    const found = findTemplate(rep?.templateId, englishTemplatesRef.current);
    // AI 칸 템플릿인데 AI 글이 없으면 다시 짜지 않는다(코멘트 빠진 글이 저장·복사되지 않게 — canRecompose).
    if (!su || !found || !canRecompose(found, rep)) return { draft, autoDraft: rep?.autoDraft };
    const facts = englishFactsOf(student, su, rep, jj.cacheRef.current);
    const composed = composeEnglishDraft(found, facts, rep ?? {});
    // 강사가 넣은 사진·PDF 자리 줄은 따라온다 — 지문(templateHash)은 첨부 줄을 뺀 템플릿 글로 남긴다(english-draft.ts).
    const text = carryAttachmentLines(draft, composed);
    const factsKey = templateFactsKey(facts, rep?.nextTest ?? "", factTokensOf(found));
    if (text !== draft || rep?.composedFactsHash !== factsKey) {
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        autoDraft: text,
        templateHash: templateHashOf(composed),
        composedFactsHash: factsKey,
      }));
    }
    return { draft: text, autoDraft: text };
  }
  /**
   * 영어 행 자동작성 — AI 인사말·코멘트를 받아 고른 템플릿에 채운다. 결과를 **상태로 돌려준다**
   * (일괄 작성은 `quiet`로 부르고 토스트를 모아서 한 번에 알린다).
   */
  async function generateEnglishDraftFor(
    student: OneScreenStudent,
    su: Subject,
    quiet = false,
  ): Promise<EnglishGenStatus> {
    const subjectName = su.name;
    const rep0 = reportsRef.current[student.id]?.[subjectName];
    // 대기 중인 선택(AI 글이 없어 아직 글에 못 쓴 템플릿)이 있으면 그것으로 — 자동작성이 그 선택을 완성한다.
    const found0 = findTemplate(rep0?.pendingTemplateId ?? rep0?.templateId, englishTemplatesRef.current);
    // 목록을 받기 전·못 받았을 땐 사용자 템플릿이 "없다"고 단정하지 않는다 — 기본 템플릿으로 바꿔 끼우면 고른 템플릿이
    // 조용히 사라진다(적대 재리뷰 2026-09-10). 기다렸다(또는 새로 고친 뒤) 다시 누르게 한다.
    if (!found0 && (!templatesLoadedRef.current || templateListFailedRef.current)) {
      if (!quiet) toast.message(t(templateListFailedRef.current ? "os.tpl.listFailedRetry" : "os.tpl.loading"));
      return "loading";
    }
    const draftBefore = rep0?.draft ?? "";
    // 🔴 고친 글(템플릿 글 그대로가 아님)을 자동작성이 말없이 덮지 않는다 — 다시 채우기와 같은 확인(일괄 작성은 글 있는
    //    행을 애초에 건너뛴다). 'AI 코멘트 옛 값' 경고의 해법이 곧 자동작성이라 더 중요하다(적대 재리뷰 2026-09-10).
    if (
      !quiet &&
      // 사진·PDF 줄만 있는 행은 '고친 글'이 아니다 — 묻지 않는다(그 줄은 새 글에 따라온다).
      hasTextBesidesAttachments(draftBefore) &&
      !isUntouchedTemplateDraft(rep0) &&
      !window.confirm(t("os.tpl.autoOverwriteConfirm"))
    ) {
      return "cancelled";
    }
    // 그림 칸 템플릿이면 인재원 하루치를 AI와 **나란히** 받는다(기다림을 늘리지 않게) — 조립 전에 기다린다.
    // 🔴 자동작성은 **항상 새로** 받는다(force) — 카드를 수업 전에 열어 둔 채면 수업 중 본 시험이 빠진다(적대 리뷰 2026-09-11).
    const jjOpts = { outOfClass: rowOutOfClass(student, su), force: true };
    let jjReady = templateImageSlots(found0 ?? DEFAULT_ENGLISH_TEMPLATE).length ? jj.ensure(student.id, jjOpts) : null;
    let ai: { intro: string; comment: string; factsHash: string } | null = null;
    // 템플릿에 AI 칸이 하나도 없으면 AI를 부르지 않는다(헛돈 쓰지 않게).
    if (templateNeedsAi(found0 ?? DEFAULT_ENGLISH_TEMPLATE)) {
      const idx = student.subjects.indexOf(su);
      // 🔴 반 전체 안내를 개인 관찰과 갈라 준다 — 수학 자동작성과 **같은 모집단**(지금 화면의 로스터 전체)으로
      //    판정한다(class-notice.ts). 안 가르면 한 반 글이 서로 복사본이 된다(2026-08-13 실측).
      const classNotices = detectClassNotices(
        studentsRef.current.flatMap((st) =>
          st.subjects.map((row) => ({ classId: row.classId, note: resolveRowFields(st, row).note })),
        ),
      );
      const base = buildReportCommentInput(student, idx, classNotices); // 태도·과제·특이사항 — 수학과 같은 층
      const facts = englishFactsOf(student, su);
      const nextTest = rep0?.nextTest ?? "";
      try {
        const res = await generateEnglishMent({
          studentName: student.name,
          // 복습·문제풀이 한 줄까지(aiFactsOf와 같은 값) — AI가 "진도를 나갔다"고 거꾸로 쓰지 않게(원장 2026-10-26).
          progress: progressWithMode(facts.progress, facts.progressMode),
          homeworkToday: facts.homeworkToday,
          testText: englishTestText({ daily: facts.dailyTest, check: facts.checkTest }),
          nextTest,
          attitude: base.attitude,
          homework: base.homework,
          // 템플릿이 특이사항을 '사랑의 한마디'로 원문 그대로 싣는다면 AI엔 안 준다(두 번 나가지 않게, templateCarriesNote).
          specialNote: templateCarriesNote(found0 ?? DEFAULT_ENGLISH_TEMPLATE) ? "" : base.specialNote,
          classContext: (su.classId && classNarratives[su.classId]) || "",
          classNotice: base.classNotice ?? "",
        }, { studentId: student.id, reportDate: activeDate }); // 직전 보고서 표현을 피하는 재료(원장 2026-10-26)
        // 지문은 **보낸 사실**로 남긴다 — 기다리는 동안 점수가 바뀌면 곧바로 'AI 코멘트가 옛 값 기준'이 뜬다.
        if (res.ok) ai = { intro: res.intro, comment: res.comment, factsHash: aiFactsHashOf(facts, nextTest) };
      } catch {
        // 아래에서 알린다
      }
      if (!ai) {
        // 🔴 AI가 실패하면 **글을 건드리지 않는다** — 코멘트 빈 글이 발송 게이트(멘트 필수)를 통과해 나가면 안 되고,
        //    지난 AI 코멘트를 ""로 덮어 되살릴 길을 없애서도 안 된다(적대 리뷰 2026-09-10).
        if (!quiet) toast.message(t("os.tpl.aiFailed"));
        return "ai_failed";
      }
    }
    // AI를 기다리는 동안 그림 칸 템플릿으로 바꿨으면 지금 받는다 — 클릭 때 템플릿으로만 판정하면 그림이 빠진다(적대 리뷰).
    if (!jjReady) {
      const repMid = reportsRef.current[student.id]?.[subjectName];
      const tplMid = findTemplate(repMid?.pendingTemplateId ?? repMid?.templateId, englishTemplatesRef.current);
      if (templateImageSlots(tplMid ?? DEFAULT_ENGLISH_TEMPLATE).length) jjReady = jj.ensure(student.id, jjOpts);
    }
    // 인재원 하루치 — 실패해도 글은 짠다(모르는 그림 칸은 기준 글 그대로 = 중립, slotFactsFor).
    if (jjReady) await jjReady;
    const nowRep = reportsRef.current[student.id]?.[subjectName];
    // 🔴 만드는 동안 강사가 **직접** 고쳤으면 글은 덮지 않는다(다시 채우기의 확인과 같은 원칙). 저장 직전 재조립처럼
    //    템플릿 글 그대로 바뀐 것은 고친 게 아니다(지문으로 가른다).
    // 사진·PDF 줄만 넣은 것은 고친 게 아니다(문장만 비교한다) — 그 줄은 아래 carryAttachmentLines가 새 글에 옮겨 심는다.
    if (
      withoutAttachmentLines(nowRep?.draft ?? "") !== withoutAttachmentLines(draftBefore) &&
      !isUntouchedTemplateDraft(nowRep)
    ) {
      // AI 결과는 버리지 않되 **대기칸**에 둔다(버리면 같은 글을 또 돈 들여 만든다). 🔴 글에 든 AI 문장·지문은 그대로
      //    둬야 한다 — 새 지문을 바로 쓰면 옛 코멘트가 든 글이 'AI 코멘트 옛 값' 경고 없이 나간다(적대 재리뷰 2026-09-10).
      //    '다시 채우기'가 대기칸으로 채우고 지문을 옮긴다.
      if (ai) {
        const got = ai;
        patchReport(student.id, subjectName, (r) => ({ ...r, pendingAi: got }));
      }
      if (!quiet) toast.message(t("os.tpl.editedDuringGen"));
      return "edited";
    }
    // 조립은 **지금** 칸 값·템플릿으로 — 기다리는 동안 진도·다음 시간 테스트·템플릿이 바뀌었을 수 있다.
    const nowStudent = studentsRef.current.find((s) => s.id === student.id) ?? student;
    const nowSu = nowStudent.subjects.find((x) => x.name === subjectName) ?? su;
    const wantId = nowRep?.pendingTemplateId ?? nowRep?.templateId;
    const found = findTemplate(wantId, englishTemplatesRef.current);
    const templateId = found ? wantId : undefined;
    const aiIntro = ai ? ai.intro : nowRep?.aiIntro;
    const aiComment = ai ? ai.comment : nowRep?.aiComment;
    const aiFactsHash = ai ? ai.factsHash : nowRep?.aiFactsHash;
    const nowFacts = englishFactsOf(nowStudent, nowSu, nowRep, jj.cacheRef.current);
    const composed = composeEnglishDraft(found ?? DEFAULT_ENGLISH_TEMPLATE, nowFacts, {
      nextTest: nowRep?.nextTest,
      aiIntro,
      aiComment,
    });
    // 강사가 넣어 둔 사진·PDF 자리 줄은 새 글에도 따라온다(지문은 첨부 줄을 뺀 템플릿 글 — english-draft.ts).
    const text = carryAttachmentLines(nowRep?.draft, composed);
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      templateId,
      templateImplicit: undefined, // 글이 됐다 — 이제 강사의 템플릿이다
      draft: text,
      autoDraft: text, // 작성 방식 스냅샷(0214a) — 수학과 같은 규약
      templateHash: templateHashOf(composed),
      composedFactsHash: templateFactsKey(
        nowFacts,
        nowRep?.nextTest ?? "",
        factTokensOf(found ?? DEFAULT_ENGLISH_TEMPLATE),
      ),
      aiIntro,
      aiComment,
      aiFactsHash,
      pendingAi: undefined, // 새 AI 글이 들어갔으니 대기칸은 버린다
      pendingTemplateId: undefined, // 고른 템플릿이 글이 됐다
      // 🔴 새 글이다 — 앞선 '그대로' 확인은 옛 글에 대한 것이라 버린다(안 버리면 새 글이 확인 없이 나갔다, 적대 재리뷰).
      outputAck: undefined,
    }));
    if (found) return "ok";
    if (!quiet) toast.message(t("os.tpl.templateMissing"));
    return "template_fallback";
  }
  /**
   * 템플릿으로 다시 채우기 — 지금 칸 값 + 마지막 AI 인사말·코멘트로 글을 다시 만든다(AI 재호출 없음).
   * 🔴 강사가 손본 글이면 먼저 묻는다 — 말없이 덮으면 고친 문장이 사라진다.
   */
  async function refillEnglishFor(student: OneScreenStudent, subjectName: string, templateId?: string) {
    const busyKey = `${student.id}|${subjectName}`;
    if (refillBusyRef.current.has(busyKey)) {
      // 받는 중에 또 누름 — '다시 채우기' 연타는 버리고(확인 창이 겹쳐 뜬다), 다른 템플릿 고르기는 기억해 뒀다 끝난 뒤 채운다.
      if (templateId) refillNextRef.current.set(busyKey, templateId);
      return;
    }
    refillBusyRef.current.add(busyKey);
    try {
      await refillEnglishInner(student, subjectName, templateId);
    } finally {
      refillBusyRef.current.delete(busyKey);
    }
    const next = refillNextRef.current.get(busyKey);
    refillNextRef.current.delete(busyKey);
    if (next && next !== templateId) await refillEnglishFor(latestStudent(student, subjectName), subjectName, next);
  }
  async function refillEnglishInner(student: OneScreenStudent, subjectName: string, templateId?: string) {
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!su) return;
    // 그림 칸 템플릿이면 인재원 하루치를 먼저 **새로** 받는다 — 모르는 채로(또는 수업 전에 받아 둔 옛 값으로) 채우면
    // 그림 줄이 지금 자료와 상관없이 정해진다(적대 리뷰 2026-09-11).
    const rep0 = reportsRef.current[student.id]?.[subjectName];
    const want = findTemplate(templateId ?? rep0?.pendingTemplateId ?? rep0?.templateId, englishTemplatesRef.current);
    if (want && templateImageSlots(want).length) {
      await jj.ensure(student.id, { outOfClass: rowOutOfClass(student, su), force: true });
    }
    const rep = reportsRef.current[student.id]?.[subjectName];
    const nextId = templateId ?? rep?.pendingTemplateId ?? rep?.templateId;
    const found = findTemplate(nextId, englishTemplatesRef.current);
    if (!found && (!templatesLoadedRef.current || templateListFailedRef.current)) {
      toast.message(t(templateListFailedRef.current ? "os.tpl.listFailedRetry" : "os.tpl.loading"));
      return;
    }
    const keptId = found ? nextId : undefined;
    const template = found ?? DEFAULT_ENGLISH_TEMPLATE;
    // 작성 중 수정으로 대기칸에 받아 둔 AI 글이 있으면 그것으로 채운다(지문도 함께 옮긴다).
    const pending = rep?.pendingAi;
    const ai = pending
      ? { aiIntro: pending.intro, aiComment: pending.comment, aiFactsHash: pending.factsHash }
      : { aiIntro: rep?.aiIntro, aiComment: rep?.aiComment, aiFactsHash: rep?.aiFactsHash };
    // 🔴 AI 칸이 있는 템플릿인데 AI 글을 한 번도 못 만든 행 — 사실 줄만 있는 글이 '멘트 있음'으로 발송 게이트를
    //    지나면 안 된다(AI 실패 때 글을 안 바꾸는 것과 같은 원칙, 적대 재리뷰 2026-09-10).
    // 🔴 글의 템플릿(templateId)은 **바꾸지 않는다** — 바꾸면 글·지문은 옛 템플릿인데 판정은 새 템플릿으로 해서, 그사이
    //    고친 점수를 못 알아보고 옛 값이 저장·복사됐다(적대 재리뷰). 고른 것은 대기(pendingTemplateId)로만 둔다.
    if (templateNeedsAi(template) && !ai.aiIntro?.trim() && !ai.aiComment?.trim()) {
      const pendingTemplateId = keptId === rep?.templateId ? undefined : keptId;
      patchReport(student.id, subjectName, (r) => ({ ...r, pendingTemplateId }));
      toast.message(t("os.tpl.needAiFirst"));
      return;
    }
    // 🔴 템플릿이 만든 글 그대로가 아니면(고친 글·가져온 글·옛 글) 먼저 묻는다 — 판정은 지문(english-draft.ts).
    const edited = hasTextBesidesAttachments(rep?.draft) && !isUntouchedTemplateDraft(rep);
    if (edited && !window.confirm(t("os.tpl.overwriteConfirm"))) return;
    if (!found) toast.message(t("os.tpl.templateMissing"));
    const facts = englishFactsOf(student, su, rep, jj.cacheRef.current);
    const composed = composeEnglishDraft(template, facts, {
      nextTest: rep?.nextTest,
      aiIntro: ai.aiIntro,
      aiComment: ai.aiComment,
    });
    // 사진·PDF 자리 줄은 다시 채워도 따라온다(덮기 확인은 문장을 고친 경우만 — 첨부 줄은 고친 글로 치지 않는다).
    const text = carryAttachmentLines(rep?.draft, composed);
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      templateId: keptId,
      templateImplicit: undefined,
      draft: text,
      autoDraft: text,
      templateHash: templateHashOf(composed),
      composedFactsHash: templateFactsKey(facts, rep?.nextTest ?? "", factTokensOf(template)),
      ...ai,
      pendingAi: undefined,
      pendingTemplateId: undefined,
      // 🔴 새 글이다 — 앞선 '그대로' 확인은 옛 글에 대한 것이라 버린다(다시 채우기로 옛 코멘트가 돌아와도 다시 묻는다).
      outputAck: undefined,
    }));
  }
  /** 템플릿 바꾸기 — 아직 글이 없으면 고르기만(자동작성 때 그 템플릿으로 채워진다), 있으면 다시 채운다. */
  function setEnglishTemplateFor(student: OneScreenStudent, subjectName: string, templateId: string) {
    // 고른 템플릿이 그 반의 내 기본값이 된다(원장 2026-10-27) — 같은 반의 빈 행도 지금 따라오고, 다음에 여는 빈 행도 이것으로
    // 시작한다. 실패해도 고르기는 그대로(보기 설정). 반이 없는 행(수업외 보강)은 계정 값만 바뀐다.
    if (!readonlyView) {
      const classId = rowClassId(student.id, subjectName);
      templatePrefsRef.current = rememberTemplate(templatePrefsRef.current, templateId, classId);
      void setMyLastReportTemplate(templateId, classId).catch(() => undefined);
      if (classId) {
        const englishClassOf = (sid: string, name: string) => {
          const row = studentsRef.current.find((x) => x.id === sid)?.subjects.find((x) => x.name === name);
          return row?.subjectKey === "english" ? (row.classId ?? null) : null;
        };
        setReports((prev) => retargetImplicit(prev, englishClassOf, classId, templateId));
      }
    }
    const rep = reportsRef.current[student.id]?.[subjectName];
    // 사진·PDF 줄만 있는 행도 '글 없음' — 고르기만 한다(자동작성 때 그 템플릿으로 채워지고 사진 줄은 따라온다).
    if (!hasTextBesidesAttachments(rep?.draft)) {
      patchReport(student.id, subjectName, (r) => ({ ...r, templateId, templateImplicit: undefined, pendingTemplateId: undefined }));
      return;
    }
    void refillEnglishFor(student, subjectName, templateId);
  }
  function setNextTestFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "nextTest");
    patchReport(studentId, subjectName, (r) => ({ ...r, nextTest: text }));
  }
  /**
   * 글 복사 — 영어 반 보드 자동 발송이 열리기 전까지 강사가 ClassNote에 붙여 넣는 **유일한** 길.
   * 🔴 복사가 실패하면 실패라고 말한다 — 성공 토스트만 띄우면 앞 학생 글이 클립보드에 남은 채 붙여 넣어진다.
   */
  async function copyEnglishText(student: OneScreenStudent, subjectName: string) {
    // 🔴 영어는 지금 '글 복사'가 학부모에게 닿는 **실제 경로**다(ClassNote 발송 과목이 아니다) — 발송 확인과 같은 판정으로 묻는다.
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(student, su, "os.tpl.outdatedCopy")) return;
    // 그림 자리 줄(`[시험결과지]`)은 글자로 내보내지 않는다 — 대괄호가 학부모 글에 그대로 붙여 넣어지면 안 된다.
    // 🔴 복사 전엔 인재원을 **기다리지 않는다** — Safari는 클릭 처리 중에만 클립보드 쓰기를 허락해, 네트워크를 기다리면
    //    복사가 실패한다(적대 재리뷰). 복사 글은 그림 줄을 어차피 지우므로 받아 둔 자료로 충분하다.
    const text = stripImageSlots(freshEnglishDraft(student, subjectName).draft).trim();
    if (!text) {
      toast.message(t("os.tpl.copyEmpty"));
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      toast.success(t("os.tpl.copied"));
    } catch {
      toast.error(t("os.tpl.copyFailed"));
    }
  }
  // AI 학부모 멘트 + 학습 추세 생성 코어(카드·표 공용) — 멘트 실패 시 결정적 템플릿 폴백,
  // 추세는 표본 부족/실패면 조용히 생략(기존 값 유지). 둘을 학생별 병렬(Promise.all)로 생성해 지연 최소화.
  /** 자동작성 — 기다린 시간을 작성 시간 기록의 '자동작성' 영역에 적는다(선생님 손 시간과 따로). */
  async function generateDraftFor(
    student: OneScreenStudent,
    subjectName: string,
    opts?: { quiet?: boolean },
  ): Promise<EnglishGenStatus | undefined> {
    const startedAt = Date.now();
    try {
      return await generateDraftForInner(student, subjectName, opts);
    } finally {
      if (!readonlyView) markAutowrite(activeDate, student.id, subjectName, startedAt);
    }
  }
  async function generateDraftForInner(
    student: OneScreenStudent,
    subjectName: string,
    opts?: { quiet?: boolean },
  ): Promise<EnglishGenStatus | undefined> {
    if (readonlyView) return; // 조용히 — 상위 진입(autoWrite*)이 이미 토스트를 띄운다(일괄이면 N개가 쌓인다)
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    if (idx < 0) return;
    const su = student.subjects[idx];
    // 🔑 영어 행 = 템플릿 모드(2026-09-10) — 멘트·추세 대신 템플릿 글을 만든다. 수학 경로는 아래 그대로다.
    if (su?.subjectKey === "english") return generateEnglishDraftFor(student, su, opts?.quiet ?? false);
    // ⚠️ 과목**키**(math…)여야 한다 — su.name엔 반 이름이 붙을 수 있어 폴백도 subjectLabel 먼저.
    const subjectKey = su?.subjectKey || su?.subjectLabel || su?.name || undefined;
    // 반 공통 서술(G6) — 이 행의 반 서술을 생성 재료로 동봉(없으면 기존 동작). 카드·표·일괄 공용 경로라 전부 커버.
    // ⚠️ 키 = classId(이름 아님) — 동명 반(수학·영어 같은 이름, 스키마 허용)에서 이름 키면 남의 반 수업
    // 맥락이 교차 주입된다(리뷰 확정 major, 순서 기능 동명 가드와 같은 원인). classId null(모호 행·보강)=서술 없음.
    const classContext = (su?.classId && classNarratives[su.classId]) || "";
    // 이 행의 평가값 — 멘트(buildReportCommentInput)와 **같은 층**을 추세 재료로도 쓴다.
    const rowEval = resolveRowFields(student, su);
    // 🔴 특이사항 칸에 들어온 **반 공지**를 개인 관찰과 갈라 준다(class-notice.ts) — 같은 반 학생들의
    //    특이사항이 전부 똑같으면 그건 개인 관찰일 수 없다. 안 가르면 모델이 6명분 관찰을 지어내
    //    멘트가 서로 복사본처럼 된다(2026-08-13 실측: 한 반 6명 특이사항이 글자까지 동일).
    //    ⚠️ 판정 대상은 **화면에 있는 지금 로스터 전체**다 — 강사가 보고 있는 반들이 곧 판정 모집단이다.
    const classNotices = detectClassNotices(
      studentsRef.current.flatMap((st) =>
        st.subjects.map((row) => ({ classId: row.classId, note: resolveRowFields(st, row).note })),
      ),
    );
    // 수학 보고서 시범(테스트 학생 한정) — 이해도를 싣고, 특이사항은 반 공지로 가르지 않는다(맨 아래에 그대로 붙는다).
    const pilot = isMathReportPilot(student.id, su?.subjectKey);
    const baseInput = buildReportCommentInput(student, idx, pilot ? undefined : classNotices, activeDate);
    const commentInput = pilot
      ? {
          ...baseInput,
          understanding: activeUnderstanding(su?.today, su?.understanding),
          // 일일 테스트 '없음'이면 점수 대신 사유가 나간다(math-report-pilot-sections.ts).
          ...(su?.dailyTestSkip ? { dailyTestSkip: su.dailyTestSkip, dailyTest: "" } : {}),
          homeworkMissReason: su?.homeworkMissReason ?? "",
          attitudeNote: su?.attitudeNote ?? "",
          lessonMemo: su?.lessonMemo ?? "",
        }
      : baseInput;
    // 이번 글을 만든 값의 서명 — 발송 게이트(카드·표)가 같은 함수로 지금 값과 대조한다.
    const writtenFactsSig = pilot ? pilotRowSig(student, subjectName) : undefined;
    // 새 수학 보고서에서 선생님이 **고친 글** — 다시 쓰면 고친 말이 다 사라진다(원장 2026-10-27 *"쓴게 다 없어 진데요"*).
    //  · 값이 바뀌어 발송이 막힌 글 = AI 없이 바뀐 사실 항목만 다시 맞춘다(pilot-merge.ts) — 고친 '오늘의 수업'·손댄 항목은 그대로.
    //  · 막히지 않은 글에서 누르면 = 정말 새로 쓸지 묻는다(일괄은 고친 글을 건드리지 않는다).
    const curRep = reportsRef.current[student.id]?.[subjectName];
    const editedPilot =
      pilot && pilotCanEdit(curRep?.autoDraft) && !!(curRep?.draft ?? "").trim() && !isPilotAutoWritten(curRep?.draft, curRep?.autoDraft);
    if (editedPilot) {
      const stale = pilotSendBlocks(student, subjectName, curRep).includes("autowrite");
      if (!stale) {
        if (opts?.quiet || !window.confirm(t("os.c.pilotRewriteConfirm"))) return;
      } else {
        try {
          const res = await generateReportComment({ ...commentInput, classContext }, {
            studentId: student.id,
            subject: subjectKey,
            classId: su?.classId ?? null,
            date: date || undefined,
          }, { pilotKeepUnderstanding: pilotSectionBody(curRep?.draft, PILOT_SECTION_TITLES.understanding) });
          if (!(res.ok && res.comment)) {
            toast.error(t("os.c.pilotGenFailed"));
            return;
          }
          const fresh = res.comment;
          patchReport(student.id, subjectName, (r) => {
            const merged = mergePilotDraft(r.draft, r.autoDraft, fresh);
            return { ...r, draft: merged.draft, autoDraft: merged.autoDraft, pilotFactsSig: writtenFactsSig };
          });
          if (!opts?.quiet) toast.success(t("os.c.pilotMerged"));
        } catch {
          toast.error(t("os.c.pilotGenFailed"));
        }
        return;
      }
    }
    try {
      // 통합 1회 호출 — 멘트 + 추세를 한 번에 생성(비용·지연↓).
      const res = await generateReportComment({ ...commentInput, classContext }, {
        studentId: student.id,
        subject: subjectKey,
        classId: su?.classId ?? null, // 정규/특강 추세 분리(2026-07-23) — 이 행의 반.

        // 🔴 추세가 **숫자를 말하는** 자리다 — 재료는 멘트와 같은 행 값(row-fields.ts)이어야 한다.
        //    2026-08-13에 점수·과제 수행률이 행 단위로 갈렸는데 이 두 줄만 학생 값으로 남아, 강사가 그 행에서
        //    점수를 고쳐도 추세엔 **다른 행(정규)의 점수**가 실렸다(보강·특강 행일수록 어긋난다).
        todayExamInfo: buildExamInfoOf(rowEval.tests, showDailyTest, showCheckTest),
        todayHomework: rowEval.homework,
        date: date || undefined, // 보는 날짜 — 과거 날짜면 추세를 그 날짜 기준으로(이후 채점 이력 있으면 추세 생략)
      });
      // 시범 대상은 기본 문구로 대신 채우지 않는다 — 진도·이해도·특이사항 구조가 없는 글이 '자동작성'으로 잡혀 발송 게이트를 지난다.
      if (pilot && !(res.ok && res.comment)) {
        toast.error(t("os.c.pilotGenFailed"));
        return;
      }
      const text = res.ok && res.comment ? res.comment : buildSubjectReport(student, idx);
      if (!res.ok) toast.message(t("os.c.aiFallback"));
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        // 작성 방식 스냅샷(0214a) — AI 성공분·템플릿 폴백 모두 "자동이 넣은 텍스트". 저장 시 draft와 비교.
        autoDraft: text,
        // 수학 보고서 시범 — 이번 글을 만든 이해도 서명(점수가 글에 숫자로 없어 발송 게이트가 이걸로 대조한다).
        ...(pilot ? { pilotFactsSig: writtenFactsSig } : {}),
        // 폴백 템플릿이면 표시 — 자동작성 원문(0370a)으로 싣지 않는다.
        autoDraftTemplate: !(res.ok && res.comment),
        // 추세는 생성 성공 시에만 갱신(표본 부족·실패면 기존 초안·수동 입력 보존). 만들었지만 검사에 걸려 버렸으면 비운다
        // (예전 초안이 그대로 나가지 않게 — 2026-10-15). 달라진 게 없으면(trendQuiet) 칸이 지난 자동작성 글 그대로일 때만 비운다
        // — 선생님이 손으로 쓰거나 고친 추세는 지킨다(적대적 재리뷰 2026-10-16).
        ...(res.ok && res.trend
          ? { trendDraft: res.trend, trendAutoDraft: res.trend }
          : res.ok && res.trendDropped
            ? { trendDraft: "", trendAutoDraft: "" }
            : res.ok && res.trendQuiet && (r.trendDraft ?? "") === (r.trendAutoDraft ?? "")
              ? { trendDraft: "", trendAutoDraft: "" }
              : {}),
      }));
    } catch {
      if (pilot) {
        toast.error(t("os.c.pilotGenFailed"));
        return;
      }
      const fallback = buildSubjectReport(student, idx);
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: fallback, autoDraft: fallback, autoDraftTemplate: true }));
      toast.message(t("os.c.aiFallback"));
    }
  }
  async function autoWriteSubject(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const student = selected; // 클로저 고정 — 생성 중 학생 전환돼도 원래 학생에 반영
    setGenSubject(subjectName);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenSubject((cur) => (cur === subjectName ? null : cur));
    }
  }
  // 표: 행별 자동작성(genKey로 그 행만 로딩) + 일괄 자동작성(순차). 생성된 draft는 일괄 발송이 그대로 사용.
  async function autoWriteRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const key = `${student.id}::${subjectName}`;
    setGenKey(key);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenKey((cur) => (cur === key ? null : cur));
    }
  }
  // 이 행의 **최신** ClassNote 상태 — 화면 state(방금 보낸 결과·워커 폴링 반영)가 로스터 스냅샷을 이긴다.
  // ⚠️ 로스터 값만 보면 "방금 보낸 건"을 모른 채 일괄 발송이 그 행을 다시 집는다(중복 게시).
  function liveClassnoteStatus(studentId: string, subjectName: string): string | null | undefined {
    return reportsRef.current[studentId]?.[subjectName]?.classnoteStatus;
  }
  // 표 일괄 작업 대상 — keys(체크된 행) 있으면 그 교집합, 없으면 표시 행 전체. 진도 필수 공통.
  // ⚠️ action별 판정(2-3, isRowActionable): save=결석 포함(기록 보존), send/autowrite=결석 제외(발송·AI 무의미).
  //    send는 **이미 발송된 행도 제외**(중복 게시 차단, 2026-07-22) — 최신 상태를 override로 넘긴다.
  function selectRows(action: RowAction, keys?: string[]) {
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL))
      .filter((r) => rowInClass(r.subject, activeClassFilter)) // 특정 반이면 그 반 행만(타 반 혼입 차단)
      .filter((r) =>
        isRowActionable(
          r.subject,
          action,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
          {
            attendanceReadOnly: !canEditAttendance, // 출결 쓰기 권한 없음 = 미체크 게이트 해당 없음(P0-3)
            progressOptional: isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name]), // SRS 글은 진도 불필요
          },
        ),
      );
    if (!keys || keys.length === 0) return all;
    const set = new Set(keys);
    return all.filter((r) => set.has(r.key));
  }
  async function autoWriteAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) return; // 재진입·중첩 방지
    const eligible = selectRows("autowrite", keys);
    const skipped = keys?.length ? keys.length - eligible.length : 0; // 선택했지만 진도 없어 제외된 행(미선택=전체=0, 음수 방지 #11)
    // ⚠️ 이미 멘트가 있는 행은 **건너뛴다** — 손으로 다듬은 문구를 일괄 재생성이 확인 없이 덮어쓰던 문제(#12 확정).
    //    개별 '자동작성' 버튼(autoWriteRow)은 그 행만 명시 재생성하므로 재생성 의도는 그쪽으로.
    // 사진·PDF 줄만 있는 행은 글이 없는 행이다(영어 — 그 줄은 새 글에 따라온다). 수학 글엔 첨부 줄이 없어 결과가 같다.
    const hasDraft = (r: (typeof eligible)[number]) =>
      hasTextBesidesAttachments(reportsRef.current[r.student.id]?.[r.subject.name]?.draft);
    // 예외 — 새 수학 보고서의 **손대지 않은 자동작성 글**인데 그 뒤 값(출결·점수·태도…)이 바뀐 행은 다시 쓴다(원장 2026-10-26).
    //   그 글은 사람이 다듬은 글이 아니라 옛 값으로 쓴 기계 글이고, 다시 안 쓰면 행마다 눌러야 발송이 풀린다. 고친 글은 그대로 건너뛴다.
    const staleAuto = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    // 선생님이 고친 글인데 값이 바뀌어 막힌 행 — AI 없이 바뀐 항목만 맞춘다(고친 말은 그대로, generateDraftFor의 합치기). 원장 2026-10-27.
    const staleEdited = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        pilotCanEdit(rep?.autoDraft) &&
        !isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    const rows = eligible.filter((r) => !hasDraft(r) || staleAuto(r) || staleEdited(r));
    const preserved = eligible.length - rows.length;
    if (rows.length === 0) {
      toast.message(
        preserved
          ? tf("os.c.genNonePreserved", { n: preserved })
          : t("os.c.genNone"),
      );
      return;
    }
    setBulkGen(true);
    // 영어 행 결과는 모아서 한 번에 알린다(행마다 토스트를 띄우면 30개가 쌓인다) — 글을 안 바꾼 행은 '완료'에서 뺀다.
    let englishSkipped = 0;
    let templateFallback = false;
    try {
      for (const r of rows) {
        setGenKey(`${r.student.id}::${r.subject.name}`);
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const status = await generateDraftFor(student, r.subject.name, { quiet: true });
        if (status === "loading" || status === "ai_failed" || status === "edited") englishSkipped++;
        else if (status === "template_fallback") templateFallback = true;
      }
    } finally {
      setGenKey(null);
      setBulkGen(false);
    }
    toast.success(
      tf("os.c.genDone", { n: rows.length - englishSkipped }) +
        (preserved ? tf("os.c.genPreserved", { n: preserved }) : "") +
        (skipped ? tf("os.c.genSkipped", { n: skipped }) : ""),
    );
    if (englishSkipped) toast.message(tf("os.tpl.bulkSkipped", { n: englishSkipped }));
    if (templateFallback) toast.message(t("os.tpl.templateMissing"));
  }
  // 값 일괄 적용(1-2) — 선택(없으면 표시 전체) 행에 채워진 필드만 반영. 빈 필드=미적용(지우기 아님).
  // 대상은 진도 필터 없는 raw 행(발송가능 selectRows와 별개 경로) — 값 채우기는 진도와 무관.
  //
  // ⚠️ **출결만 즉시 서버에 쓴다**(2026-07-30). 나머지 칸은 화면 state를 고치고 자동저장 큐에 실리지만
  // 출결의 원장은 출석부(attendance_records)라, 여기서 화면만 바꾸면 출석부와 갈라진다. 그래서 셀 액션이
  // 아니라 **배치 액션 1회**(setAttendanceBulk)로 보낸다 — 30~40행을 셀 단위로 부르면 왕복이 그만큼 늘어
  // 반응속도(1순위)를 깎는다. 게이트(담당 반·수강생·수정 기간)는 그 액션이 집합 단위로 강제한다(#77).
  async function bulkApplyValues(
    keys: string[],
    patchFields: BulkPatch,
    onlyEmpty: boolean,
    progressSubjectKey: string,
    attendance: BulkAttendanceStatus | null = null,
    attendanceUnits = "", // 수업타임(시수) — 새로 만드는 출결 행에만(서버 setAttendanceBulk 규약)
    videoCheck: VideoHomeworkStatus | null = null, // 지난 영상 숙제 검사 — 출결처럼 즉시 기록(검사 칸이 있는 행만)
  ) {
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const plan = planBulkApply(
      rows.map((r) => {
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
      }),
      patchFields,
      onlyEmpty,
      progressSubjectKey,
    );
    // 값 칸은 먼저 즉시 반영(출결 왕복을 기다리게 하지 않는다). 작성 시간 기록엔 '일괄'로 센다(write-timing-store).
    const endBulkOrigin = beginWriteOrigin("bulk");
    try {
    for (const p of plan) {
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.subjectName, p.set.attitude);
      if (p.set.attitudeNote !== undefined) setAttitudeNoteFor(p.studentId, p.subjectName, p.set.attitudeNote);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.subjectName, p.set.homework);
      if (p.set.homeworkMissReason !== undefined) setHomeworkMissReasonFor(p.studentId, p.subjectName, p.set.homeworkMissReason);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      if (p.set.progressMode !== undefined) setProgressModeFor(p.studentId, p.subjectIndex, p.set.progressMode);
      // 이해도 — 진도 **다음에** 넣는다(같은 차례에 바꾼 진도의 소단원에 채워지게, setAllUnderstandingFor는 patch 안의 행 값을 읽는다).
      if (p.set.understanding !== undefined) setAllUnderstandingFor(p.studentId, p.subjectName, p.set.understanding);
      // 뺄 소단원(원장 2026-10-27) — 계획이 그 행 진도에 있는 것만 골라 왔다.
      for (const lesson of p.set.understandingOff ?? []) toggleUnderstandingFor(p.studentId, p.subjectName, lesson, true);
      // 2026-10-02 추가 칸 — 전부 **그 행에만**(행 값). 문항수를 먼저 바꾸고 점수를 넣는다(문항수 변경이 점수를 깎으므로).
      if (p.set.note !== undefined) setNoteFor(p.studentId, p.subjectName, p.set.note);
      if (p.set.dailyMax !== undefined) setMaxFor(p.studentId, p.subjectName, "daily", p.set.dailyMax);
      if (p.set.dailyScore !== undefined) setScoreFor(p.studentId, p.subjectName, "daily", p.set.dailyScore);
      if (p.set.checkMax !== undefined) setMaxFor(p.studentId, p.subjectName, "check", p.set.checkMax);
      if (p.set.checkScore !== undefined) setScoreFor(p.studentId, p.subjectName, "check", p.set.checkScore);
      // 일일 테스트 '안 봄'(원장 2026-10-27) — null이면 '봄'으로(이번에 점수를 넣은 행, grid.ts planBulkApply).
      if (p.set.dailyTestSkip !== undefined) setTestSkipFor(p.studentId, p.subjectName, p.set.dailyTestSkip);
      const { videoHomework: bulkVideoHw, videoSubmitLink: bulkVideoLink, videoHomeworkDue: bulkVideoDue } = p.set;
      if (bulkVideoDue !== undefined) rememberVideoDue(bulkVideoDue);
      if (bulkVideoHw !== undefined || bulkVideoLink !== undefined || bulkVideoDue !== undefined)
        patch(p.studentId, (s) => ({
          ...s,
          subjects: s.subjects.map((su) => (su.name === p.subjectName
            ? { ...su, ...(bulkVideoHw !== undefined ? { videoHomework: bulkVideoHw } : {}), ...(bulkVideoLink !== undefined ? { videoSubmitLink: bulkVideoLink } : {}),
              ...(bulkVideoDue !== undefined ? { videoHomeworkDue: bulkVideoDue } : {}),
              // 일괄로 영상 과제를 끈 행은 마감도 7일로(행 토글과 같은 규칙)
              ...(bulkVideoHw === false && su.videoHomeworkDue ? { videoHomeworkDue: "week" as const, videoHomeworkDueDate: undefined } : {}) }
            : su)),
        }));
    }
    } finally {
      endBulkOrigin();
    }
    const done: string[] = [];
    if (plan.length) {
      done.push(tf("os.c.doneRows", { n: plan.length }));
      // 감사로그 한 줄 — 값 칸만(출결·영상 검사는 그 저장 액션이 따로 남긴다). 글 내용은 안 싣는다.
      const planned = new Set(plan.map((p) => `${p.studentId}::${p.subjectName}`));
      void logOnescreenBulkApply({
        mode: "input",
        date: activeDate,
        rows: plan.length,
        classIds: rows.filter((r) => planned.has(`${r.student.id}::${r.subject.name}`)).map((r) => r.subject.classId),
        fields: [...new Set(plan.flatMap((p) => Object.keys(p.set)))],
      }).catch(() => {});
    }

    if (attendance) {
      // 팝오버가 미리보기에 쓴 것과 **같은 순수 계획**(같은 행·같은 규칙) — 화면 숫자와 실제가 어긋나지 않게.
      const attPlan = planBulkAttendance(
        rows.map((r) => ({
          studentId: r.student.id,
          classId: r.subject.classId,
          isMakeup: r.student.isMakeup,
          raw: r.subject.attendanceRaw,
        })),
        attendance,
        { onlyEmpty },
      );
      const why = describeAttendanceSkips(attPlan, lang);
      if (attPlan.cells.length === 0) {
        done.push(t("os.c.doneAttNone") + (why ? tf("os.c.doneAttSkip", { why }) : ""));
      } else {
        const attKeys = attPlan.cells.map((c) => `${c.studentId}::${c.classId}`);
        setAttPending((p) => {
          const n = new Set(p);
          attKeys.forEach((k) => n.add(k));
          return n;
        });
        try {
          const res = await setAttendanceBulk({
            sessionDate: activeDate,
            status: attendance,
            cells: attPlan.cells,
            // 수업타임(시수) — 결석엔 무의미(팝오버가 이미 안 보냄), 새로 만드는 행에만 적용된다.
            ...(attendanceUnits ? { units: attendanceUnits } : {}),
          });
          if ("error" in res) {
            toast.error(res.error);
          } else {
            // 서버가 실제로 기록한 셀만 화면에 반영 — 게이트에 걸려 빠진 셀을 '됐다'고 칠하지 않는다.
            // 시수는 **새로 만들어진(created) 행에만** 되그린다 — 갱신된 행은 기존 시수가 보존됐으므로
            // 입력값을 칠하면 화면과 DB가 갈린다(setAttendanceFor optimisticUnits와 같은 정규화: 1=null).
            const echoUnits = attendanceUnits
              ? (() => {
                  const n = Number(attendanceUnits.replace(",", "."));
                  return !Number.isFinite(n) || n === 1 ? null : n;
                })()
              : undefined;
            for (const c of res.applied)
              applyAttendanceLocal(
                c.studentId,
                c.classId,
                attendance,
                // 시수를 안 고른 일괄의 새 칸 = 서버가 넣은 수학 자동 시수(없으면 null=1, auto-units.ts).
                c.created ? { units: echoUnits !== undefined ? echoUnits : (c.autoUnits ?? null) } : undefined,
              );
            done.push(
              tf("os.c.doneAtt", { n: res.applied.length }) +
                (res.blocked ? tf("os.c.doneAttBlocked", { n: res.blocked }) : "") +
                (why ? tf("os.c.doneAttWhy", { why }) : ""),
            );
          }
        } catch {
          toast.error(t("os.c.attFail"));
        } finally {
          setAttPending((p) => {
            const n = new Set(p);
            attKeys.forEach((k) => n.delete(k));
            return n;
          });
        }
      }
    }
    // 지난 영상 숙제 검사 — 출결과 같은 성질(화면 state가 아니라 **즉시 기록**). 검사 칸이 보이는 행만(planBulkVideoCheck —
    // 팝오버가 그 줄을 그리는 조건과 같은 함수), 여러 칸을 한 왕복으로. 열람 전용 화면에선 하지 않는다(서버도 거절한다).
    if (videoCheck && videoHwStore && !readonlyView) {
      const targets = planBulkVideoCheck(
        rows.map((r) => ({
          classId: r.subject.classId, studentId: r.student.id, subjectKey: r.subject.subjectKey,
          grade: r.student.grade, homeworkDate: r.subject.prevReport?.date,
        })),
        videoHwStore,
        { status: videoCheck, onlyEmpty },
      );
      if (targets.length) {
        const res = await videoHwStore.changeMany(targets, videoCheck);
        done.push(tf("os.c.doneVideoCheck", { n: res.applied }) + (res.failed ? tf("os.c.doneVideoCheckFail", { n: res.failed }) : ""));
      }
    }
    if (done.length === 0) {
      toast.message(t("os.c.applyNone"));
      return;
    }
    toast.success(tf("os.c.applyDone", { list: done.join(" · ") }));
  }
  /**
   * 맨 위 행의 **수업 내용**(진도·교재·오늘 과제)을 아래 행 전부에 복사.
   * 대상 = 선택 행이 있으면 그 행들, 없으면 표시 전체(반 필터 반영) — 다른 일괄 작업과 같은 규약.
   * ⚠️ 점수·태도·과제 수행·학부모 문구는 **복사하지 않는다**(학생마다 다른 개별 사실 — grid.ts 주석 참조).
   */
  function copyFirstRowDown(keys: string[], overwrite: boolean) {
    return withWriteOrigin("bulk", () => copyFirstRowDownInner(keys, overwrite));
  }
  function copyFirstRowDownInner(keys: string[], overwrite: boolean) {
    if (readonlyBlocked()) return; // #103 세 뒷문 중 하나 — 잠긴 화면에 값을 밀어 넣는 경로
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const [first, ...rest] = rows;
    if (!first || rest.length === 0) {
      toast.message(t("os.c.copyNoRow"));
      return;
    }
    // 같은 반 판정의 열쇠 = 반 필터와 같은 반 이름(보강 행은 앵커 반). 반을 고른 보기에선 보이는 행이 전부 그 반이라
    // 모르는 행도 그 반으로 본다(종전과 같다) — '전체' 보기에서만 반이 다르거나 모르는 행을 건너뛴다.
    const classKeyOf = (r: (typeof rows)[number]) => rowClassName(r.subject) ?? activeClassFilter;
    const res = planCopyFirstRow(
      {
        subjectKey: first.subject.subjectKey ?? "math",
        // 같은 반 행에만 복사한다(원장 2026-10-15 — '전체' 보기에서 다른 반 빈 칸까지 채우던 것).
        classKey: classKeyOf(first),
        today: first.subject.today ?? "",
        progressMode: first.subject.progressMode ?? null,
        textbook: first.subject.textbook ?? "",
        homeworkToday: first.subject.homeworkToday ?? "",
      },
      rest.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        classKey: classKeyOf(r),
        today: r.subject.today ?? "",
        progressMode: r.subject.progressMode ?? null,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
        // 🔴 여기서 `isRowActionable(…,"save")`를 쓰면 안 된다(2026-07-23 원장 제보로 발견).
        //    그 판정은 **진도가 있어야 통과**(isReportEligible)라, 복사가 필요한 바로 그 행
        //    (진도가 빈 행)을 전부 대상에서 빼 버려 기능이 사실상 항상 0건이었다.
        //    게다가 제외 사유를 전부 "발송 완료"로 세어, 보고서가 한 건도 없는 반에서도
        //    "복사할 칸이 없습니다 — 발송 완료 6행"이라는 **거짓 문구**가 떴다.
        //    복사가 실제로 막혀야 하는 유일한 조건은 **이미 학부모에게 나간 행**이다.
        //    (세션 중 방금 보낸 건은 로스터 스냅샷이 모르므로 live 상태를 덮어 읽는다.)
        actionable: isCopyTargetRow(
          r.subject,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
        ),
      })),
      { overwrite },
    );
    if (res.plan.length === 0) {
      // 왜 아무 일도 안 일어났는지 말해준다 — "눌렀는데 무반응"이 되지 않게.
      const why = [
        // ⚠️ 이 카운터엔 결석 행(2026-08-07)과 '수업보고서 미발송' 반 행(2026-08-19)도 들어온다 —
        //    사유를 하나로 단정하면 거짓말이 된다. 판정 자체가 `isRowInputEditable`(입력 잠김)이라
        //    **잠김**이 셋 다 참인 유일한 이름이다.
        res.skippedSent ? tf("os.c.copyWhyLocked", { n: res.skippedSent }) : "",
        res.skippedSubject ? tf("os.c.copyWhySubject", { n: res.skippedSubject }) : "",
        res.skippedClass ? tf("os.c.copyWhyClass", { n: res.skippedClass }) : "",
        res.skippedNoClass ? tf("os.c.copyWhyNoClass", { n: res.skippedNoClass }) : "",
        res.skippedFilled ? tf("os.c.copyWhyFilled", { n: res.skippedFilled }) : "",
      ].filter(Boolean);
      toast.message(
        why.length ? tf("os.c.copyNoneWhy", { why: why.join(" · ") }) : t("os.c.copyNeedFirst"),
      );
      return;
    }
    for (const p of res.plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 복습·문제풀이도 진도와 함께(원장 2026-10-27) — 진도 문장이 이 값으로 갈린다.
      if (p.set.progressMode !== undefined) setProgressModeFor(p.studentId, p.subjectIndex, p.set.progressMode);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
    }
    // 감사로그 한 줄(칸 저장은 건마다 남기지 않는다 — bulk-log-actions.ts). 글 내용은 안 싣는다.
    void logOnescreenBulkApply({
      mode: "copy",
      date: activeDate,
      rows: res.plan.length,
      // 보강 행은 반 대신 앵커 반(보강을 넣은 수업)으로 적는다.
      classIds: [first, ...rest.filter((r) => res.plan.some((p) => p.studentId === r.student.id && p.subjectName === r.subject.name))]
        .map((r) => r.subject.classId ?? r.subject.makeupClassId ?? null),
      fields: [...new Set(res.plan.flatMap((p) => Object.keys(p.set)))],
    }).catch(() => {});
    const skipped = res.skippedSent + res.skippedSubject + res.skippedClass + res.skippedNoClass + res.skippedFilled;
    toast.success(
      tf("os.c.copyDone", { name: first.student.name, n: res.plan.length }) +
        (skipped
          ? tf("os.c.copySkipped", {
              n: skipped,
              why: [
                res.skippedSent ? tf("os.c.copySkipLocked", { n: res.skippedSent }) : "",
                res.skippedSubject ? tf("os.c.copySkipSubject", { n: res.skippedSubject }) : "",
                res.skippedClass ? tf("os.c.copySkipClass", { n: res.skippedClass }) : "",
                res.skippedNoClass ? tf("os.c.copySkipNoClass", { n: res.skippedNoClass }) : "",
                res.skippedFilled ? tf("os.c.copySkipFilled", { n: res.skippedFilled }) : "",
              ]
                .filter(Boolean)
                .join(", "),
            })
          : ""),
    );
  }
  // 이전 회차 가져오기(1-3) — 그 행의 **빈 칸만** 채움(진도·태도·과제·오늘 과제).
  // ⚠️ 특이사항은 채우지 않음 — prevReport.note는 학부모 발송 본문(notes)이라 특이사항이 아니다.
  function importPrevFor(student: OneScreenStudent, subjectName: string) {
    return withWriteOrigin("prev", () => importPrevForInner(student, subjectName));
  }
  function importPrevForInner(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return; // 참고행 '가져오기' — LOCK_FS 밖 버튼이라 여기서 끊는다
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    if (!su || bulkGen || bulkBusy || !isRowInputEditable(su, effectiveClassnoteStatus(liveClassnoteStatus(student.id, subjectName), su.classnoteStatus))) return;
    const rowEval = resolveRowFields(student, su);
    const fill = planPrevFill({
      prev: su.prevReport,
      current: {
        today: su.today,
        attitude: rowEval.attitude,
        homework: rowEval.homework,
        homeworkToday: su.homeworkToday ?? "",
      },
      attitudes: ATTITUDE,
    });
    const count = Object.keys(fill).length;
    if (!count) {
      toast.message(t("os.c.prevFillNone"));
      return;
    }
    if (fill.today !== undefined) setProgressFor(student.id, idx, fill.today);
    if (fill.attitude !== undefined) setAttitudeValue(student.id, subjectName, fill.attitude);
    if (fill.homework !== undefined) setHomeworkValue(student.id, subjectName, fill.homework);
    if (fill.homeworkToday !== undefined) setHomeworkTodayFor(student.id, subjectName, fill.homeworkToday);
    toast.success(tf("os.c.prevFillOne", { n: count }));
  }
  // 이전 회차 **일괄** 가져오기(G5 얕은판) — 표시(또는 선택) 전 행에 planPrevFill을 돌려 빈 칸만 채운다.
  // bulkApplyValues 대칭(대상 선정 규약 동일: keys 미선택=표시 전체, rowInClass 필터). 행별 importPrevFor와
  // 같은 순수 계획 함수를 쓰므로 특이사항·교재 제외(발송 본문 오염 방지·roster 자동 승계) 결정이 자동 준수된다.
  // "평소와 같음" 기본값의 얕은 구현 — 강사는 일괄로 깔고 달라진 학생만 손댄다(깊은판 provenance는 G4에서).
  // ⚠️ 멘트(학부모 문구)만 예외로 **확인 다이얼로그**를 거친다 — 나머지 칸은 강사가 오늘 값을 고르는 입력이지만
  // 멘트는 직전에 이미 학부모에게 나간 문장이라, 오늘 진도·점수와 어긋난 채 그대로 발송될 위험이 있다(원장 지시 07-21).
  function bulkImportPrev(keys?: string[]) {
    return withWriteOrigin("prev", () => bulkImportPrevInner(keys));
  }
  function bulkImportPrevInner(keys?: string[]) {
    if (readonlyBlocked() || bulkGen || bulkBusy) return;
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys ?? []);
    const rows = keySet.size ? all.filter((r) => keySet.has(r.key)) : all;
    // 선택된 수업 행별 현재값으로 계획한다. 다른 반·보강 행과 평가값을 공유하지 않는다.
    const plan = planBulkPrevFill(
      rows.flatMap((r) => {
        const subjectIndex = r.student.subjects.findIndex((su) => su.name === r.subject.name);
        const su = r.student.subjects[subjectIndex];
        if (!su) return [];
        return [
          {
            studentId: r.student.id,
            subjectName: r.subject.name,
            subjectIndex,
            prev: su.prevReport,
            current: {
              today: su.today,
              attitude: resolveRowFields(r.student, su).attitude,
              homework: resolveRowFields(r.student, su).homework,
              homeworkToday: su.homeworkToday ?? "",
            },
            // 잠긴 행(발송 완료·결석)은 채우지 않는다(위 일괄 적용과 같은 이유).
            locked:
              readonlyView ||
              !isRowInputEditable(
                su,
                effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), su.classnoteStatus),
              ),
          },
        ];
      }),
      ATTITUDE,
    );
    // 멘트는 별도 계획 — 초안이 빈 행 중 직전 멘트가 있는 것만. 적용은 아래 확인 다이얼로그 뒤에.
    // 🔴 영어 행은 뺀다 — 영어 글은 템플릿이 **지난 회차 진도·점수**까지 담은 전문이라, 가져오면 오늘 기록과 다른 글이
    //    그대로 나간다(적대 재리뷰 2026-09-10). 영어는 자동작성·다시 채우기로 새로 만든다.
    const commentPlan = planPrevComments(
      rows.filter((r) => r.subject.subjectKey !== "english" && isRowInputEditable(r.subject, effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus))).map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        prevNote: r.student.subjects.find((su) => su.name === r.subject.name)?.prevReport?.note,
        // ⚠️ 초안은 ref에서 — 진행 중이던 자동작성이 방금 채운 멘트를 클릭 시점 스냅샷이 못 봐 덮어쓰는 것 방지(#10).
        currentDraft: reportsRef.current[r.student.id]?.[r.subject.name]?.draft ?? "",
      })),
    );
    // 보강 학생은 이전 회차를 따로 불러와야 채워진다 — 안 불러온 학생이 대상에 있으면 알리고 그 자리에서 불러오게 한다(원장 2026-10-27).
    const makeupPending = [...new Set(rows.filter((r) => r.student.isMakeup && !prevLoaded.has(r.student.id)).map((r) => r.student.id))];
    if (makeupPending.length) {
      toast.message(tf("os.c.makeupPrevPending", { n: makeupPending.length }), {
        action: { label: t("os.c.makeupPrevLoadNow"), onClick: () => void loadMakeupPrevAll(makeupPending) },
      });
    }
    if (!plan.length && !commentPlan.length) {
      if (!makeupPending.length) toast.message(t("os.c.prevFillNone"));
      return;
    }
    let filledCells = 0;
    for (const p of plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.subjectName, p.set.attitude);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.subjectName, p.set.homework);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      filledCells += Object.keys(p.set).length;
    }
    if (plan.length) {
      toast.success(tf("os.c.prevFillMany", { rows: plan.length, cells: filledCells }));
    }
    if (commentPlan.length) setPrevCommentPlan(commentPlan); // → 확인 다이얼로그
  }
  /** 확인 다이얼로그 '멘트도 가져오기' — 계획대로 초안만 채운다(다른 칸은 위에서 이미 처리됨). */
  function applyPrevComments() {
    return withWriteOrigin("prev", () => applyPrevCommentsInner());
  }
  function applyPrevCommentsInner() {
    const plan = prevCommentPlan ?? [];
    setPrevCommentPlan(null);
    if (!plan.length) return;
    // 🔴 복사 삽입도 autoDraft 스냅샷을 함께 남긴다(0214a, 적대 리뷰 확정) — 직전 회차 문구는 AI 유래일 수
    //    있고 아니어도 "지금 직접 쓴" 문장이 아니다. setDraftFor(초안만)로 넣으면 그대로 저장 시 manual로
    //    오표기돼 말투 코퍼스가 오염된다(중복 유입 포함). 스냅샷을 남기면 그대로=auto, 고치면=auto_edited.
    for (const p of plan) {
      const su = studentsRef.current.find(s => s.id === p.studentId)?.subjects.find(s => s.name === p.subjectName);
      if (!su || !isRowInputEditable(su, effectiveClassnoteStatus(liveClassnoteStatus(p.studentId, p.subjectName), su.classnoteStatus))) continue;
      // 수학 보고서 시범 — 지난 글을 옮겨 넣으면 '자동작성 글'로 잡혀 발송 게이트를 지난다. 시범 대상은 자동작성만.
      if (isMathReportPilot(p.studentId, su.subjectKey)) continue;
      // 지난 회차 글은 AI 원문이 아니다(선생님이 직접 쓴 글일 수 있다) — 자동작성 원문(0370a)으로 싣지 않게 표시.
      patchReport(p.studentId, p.subjectName, r => r.draft.trim() ? r : ({ ...r, draft: p.comment, autoDraft: p.comment, autoDraftTemplate: true }));
    }
    toast.success(tf("os.c.prevComments", { n: plan.length }));
  }
  // 학생 순서 저장(3-2) — (강사×반) 영구 저장 + 성공 시 클라 state에도 즉시 반영(다음 로드는 roster가 적용).
  async function saveOrderForClass(classId: string, studentIds: string[]): Promise<boolean> {
    if (readonlyView) return false; // 조용히 — 드래그마다 토스트가 쌓이면 짜증(순서는 그 강사의 개인 설정이다)
    const res = await saveStudentOrder({ classId, studentIds });
    if ("error" in res) {
      toast.error(res.error);
      return false;
    }
    setStudents((prev) => applyStudentOrder(prev, new Map([[classId, studentIds]])));
    toast.success(t("os.c.orderSaved"));
    return true;
  }
  // 표 행 → 카드로 열기(그 학생 선택 + 카드 뷰). 본문 편집·첨부·링크 관리·PDF는 카드에서.
  function openReportDetails(studentId: string, subjectName?: string) {
    setSelId(studentId);
    const idx = visible.find(s => s.id === studentId)?.subjects.findIndex(su => su.name === subjectName) ?? -1;
    setCardSubject({ id: studentId, idx: Math.max(0, idx) });
    setBulkOpen(false);
    if (view === "grid") setDetailsOpen(true);
  }
  function changeView(next: OneScreenView) {
    setDetailsOpen(false);
    setBulkOpen(false);
    setPreviewOpen(false);
    setView(next);
  }
  function openCard(studentId: string) {
    setSelId(studentId);
    changeView("card");
  }
  // 학부모 공지 진입 — 카드=선택 학생 1명, 표=선택 행(없으면 보이는 전체) 학생. 공지 뷰로 전환하며 대상 seed.
  function openNoticeForStudent(studentId: string) {
    if (readonlyBlocked()) return; // 공지 뷰는 순수 작성 화면 — 열람 전용에선 열 이유가 없다(발송은 서버도 거절)
    setNoticeSeed([studentId]);
    changeView("notice");
  }
  function openNoticeForRows(keys?: string[]) {
    if (readonlyBlocked()) return; // openNoticeForStudent와 동일
    const ids =
      keys && keys.length
        ? [...new Set(keys.map((k) => k.split("::")[0]!))]
        : visible.map((s) => s.id);
    setNoticeSeed(ids);
    changeView("notice");
  }
  /**
   * 저장 입력(보고서 필드)을 (학생,과목)별로 조립 — 카드/표 공용.
   *
   * 🔴 **멘트가 비면 빈 채로 저장한다**(2026-07-30 발송 감사로 변경). 예전엔 여기서 조용히
   *    `buildSubjectReport` 템플릿을 끼워 넣었는데, 그 결과가 아래 저장 후 `patchReport`로
   *    **강사의 멘트칸에 되써져** 발송 가능 상태가 됐다 — 강사가 쓴 적 없는 문장이 강사 이름으로
   *    학부모에게 나갔다(4일치 발송분 226건 중 50건, 22%). 진도만 넣고 일괄 저장하면 벌어지는 일이라
   *    본인은 눈치채기 어렵다.
   *    이제 멘트가 비면 기록만 저장되고 발송은 게이트가 막는다("멘트 입력 필요") → 강사가 자동작성을
   *    누르거나 직접 쓰게 된다. 템플릿은 **AI 생성이 실패했을 때만**, 토스트로 알리며 멘트칸에 들어간다.
   */
  function buildSaveInputFor(student: OneScreenStudent, subjectName: string) {
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    // ⚠️ 최신 초안은 ref에서(일괄 루프 중 사용자 편집·앞 행 patch 반영) — closure `reports`는 클릭 시점 스냅샷이라 유실 위험(#10).
    const existing = reportsRef.current[student.id]?.[subjectName];
    // 영어 행: 손대지 않은 자동 글이면 지금 칸 값으로 다시 조립해서 저장한다(기록과 다른 글이 나가지 않게).
    const fresh = su?.subjectKey === "english" ? freshEnglishDraft(student, subjectName) : null;
    const draft = fresh ? fresh.draft : (existing?.draft ?? "");
    // 자동작성 스냅샷(0214a) — 작성 방식 판정과 자동작성 원문(0370a)이 같은 값을 본다.
    const autoSnap = fresh ? fresh.autoDraft : existing?.autoDraft;
    const mentSource = computeClientMentSource(draft, autoSnap);
    // 표시 필드(교재·진도·시험·태도·멘트…)는 **카드 미리보기와 같은 함수**로 만든다(report-fields.ts).
    // 여기서 따로 조립하면 "화면에 보이던 것"과 "학부모가 받은 것"이 조용히 갈라진다.
    // 🔴 평가값(태도·점수·과제 수행률)은 **행 단위**로 해석한다(row-fields.ts) — 보강은 정규와 따로 나가는
    //    다른 보고서라 값도 독립이어야 한다(원장 2026-08-13). 행에 값이 없으면 학생 값으로 폴백해
    //    옛 세션·기존 행은 지금까지와 똑같이 동작한다.
    const rowEval = resolveRowFields(student, su);
    const fields = buildReportFields({
      subject: su,
      homework: rowEval.homework,
      attitude: rowEval.attitude,
      tests: rowEval.tests,
      draft,
      jjSheet: su?.subjectKey === "english" && isJjSheetDraft(existing),
      trendDraft: existing?.trendDraft,
      // '학습 추세 미발송'(원장 2026-09-18) — ref로 읽는다(디바운스·발송은 비동기라 closure가 옛 값일 수 있다).
      trendHidden: isTrendOptedOut(trendOptOutRef.current, su?.classId, student.id),
      showDailyTest,
      showCheckTest,
    });
    return {
      draft,
      input: {
        studentId: student.id,
        reportDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — report_date가 곧 카드 표시일·ClassNote 게시일
        ...fields,
        // ⚠️ subject는 **과목키**(math)여야 한다 — 발송 과목 게이트·보드 매핑이 이 값을 본다.
        //    행 이름(name)엔 반 이름이 붙을 수 있으므로 폴백도 subjectLabel을 먼저 본다.
        subject: su?.subjectKey || su?.subjectLabel || su?.name || undefined,
        // 반(수업) — 보고서 1건의 단위(0134a). 같은 날 정규+특강이 서로 안 덮게 하는 키. 보강 행은 classId=null → unit_key=과목키.
        classId: su?.classId ?? null,
        // 보강(수업외) = 담당반·결석 게이트 우회. 카드 전체가 보강(isMakeup)이거나, **정규 카드에 병합된 보강 행**
        // (makeup=true·classId 없음)도 우회 — 그 학생의 담당반이 아닌 추가수업이라 담당반/결석 검사에 걸리면 안 된다.
        outOfClass: (student.isMakeup ?? false) || (!!su?.makeup && !su?.classId),
        // 보강 행의 소속(어느 수업 시간에 한 보강인가) — 반 필터 앵커(0171a). 정규 행이면 서버가 무시한다.
        makeupClassId: su?.makeupClassId ?? null,
        // 오늘 영상 과제(0308a) — 🔴 **값이 있을 때만** 싣는다(DB·세션에서 읽었거나 강사가 눌렀을 때). 손대지 않은 행을
        // false로 적으면 '모름'이 '없음'이 되어 다음 수업 검사가 조용히 사라진다(적대 리뷰 High). 정책이 끈 반·반 없는 행·
        // 과제 값을 못 읽은 세션(videoHwSaveOk=false — 저장돼 있던 '있음'을 덮는다)도 싣지 않는다.
        // 다른 선생님이 처음 쓴 줄도 싣지 않는다(그 선생님만 바꾼다 — 서버·DB도 한 번씩 더 막는다).
        ...(videoHwSaveOk && typeof su?.videoHomework === "boolean" && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          // 그 값을 DB와 맞춘 시각도 함께 — 장부에서 취소한 숙제를 모른 채 '있음'으로 되살리지 않게(서버 `cancels.ts`, 원장 2026-10-16).
          ? { videoHomework: su.videoHomework, videoHomeworkSeenAt: videoHwStore?.seenAtOf(student.id, su.classId) ?? null }
          : {}),
        // 영상 첨부 링크 넣기(0328a) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만 싣는다(토글이 안 보이는 행·단계는
        // 싣지 않아 저장돼 있던 값을 덮지 않는다). 영상 과제가 꺼진 행은 false로 — 과제 없이 링크만 켜진 값이 남지 않게.
        ...(videoHwSaveOk && typeof su?.videoSubmitLink === "boolean" && !videoHwByOther(student.id, su?.classId) &&
        submitLinkChoosable(submitLinkMode, videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey, grade: student.grade, studentName: student.name })
          ? { videoSubmitLink: su.videoSubmitLink && su.videoHomework === true }
          : {}),
        // 영상 숙제 마감(원장 2026-10-15) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만(영상 과제를 싣는 조건 + 마감 칸 준비됨).
        // 영상 과제가 꺼진 행은 서버가 마감을 지운다(값을 보내지 않아도). '다음 수업' 날짜는 서버가 시간표로 정한다(화면 값을 믿지 않는다).
        ...(videoDueReady && videoHwSaveOk && su?.videoHomework === true && su.videoHomeworkDue && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          ? { videoHomeworkDue: su.videoHomeworkDue }
          : {}),
        // 멘트 작성 방식(0214a) — 이번 세션 자동작성 스냅샷과 비교(최종은 서버 resolveMentSource가 sticky 판정).
        mentSource,
        // 수학 보고서 시범 — 강사 한줄 멘트(필수). 서버가 비었거나 글 끝에 안 붙었으면 거절한다.
        // 영어도 같다(원장 2026-10-26 *"영어도 수학이랑 동일하게 … 사랑의 한마디 · 필수"*).
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english" ? { pilotOneLine: rowEval.note } : {}),
        // JJ 수업보고서 글 — 사랑의 한마디가 선택이다(원장 2026-10-27). 서버가 이 표시로 '영어 한마디 필수'를 건너뛴다.
        ...(su?.subjectKey === "english" && isJjSheetDraft(existing) ? { jjSheet: true } : {}),
        // 새 수학 보고서 — 화면 발송 조건(자동작성이 지금 값 기준인가 · 사유를 다 적었나)을 서버에도 싣는다(원장 2026-10-26 일괄 발송 구멍).
        //   일괄 발송·행 발송이 모두 이 입력을 지나므로, 어느 길로 보내도 서버가 같은 조건으로 거절한다.
        // 영어 줄도 싣는다 — 보강 사유를 서버가 같은 조건으로 본다(2026-10-26). 영어엔 자동작성 조건이 없어 factsCurrent는 늘 참이다.
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english"
          ? (() => {
              const blocks = pilotSendBlocks(student, subjectName, { draft, autoDraft: autoSnap, pilotFactsSig: existing?.pilotFactsSig, templateId: existing?.templateId });
              return { pilotCheck: { factsCurrent: !blocks.includes("autowrite"), reasonsOk: !blocks.some((b) => REASON_BLOCKS.includes(b)) } };
            })()
          : {}),
        // 자동작성 후 고친 멘트면 그 자동작성 원문도 싣는다(0370a) — 말투 프로파일이 선생님이 '늘 고치는 것'을 배운다(원장 2026-10-16).
        //   영어는 템플릿 모드라 뺀다(코퍼스 밖).
        //   AI 실패 폴백 템플릿은 AI 원문이 아니라 뺀다.
        ...(mentSource === "auto_edited" && su?.subjectKey !== "english" && autoSnap && !existing?.autoDraftTemplate ? { mentAutoDraft: autoSnap } : {}),
        // 영어 결과지 고르기(2026-09-28) — 이 화면이 아는 값만 싣는다. 모르면(안 받음) 빼서 서버가 저장해 둔 고르기를 따르게.
        ...(su?.subjectKey === "english" && jjDayKey(student.id, activeDate) in jj.picksRef.current
          ? { jjExamPick: jj.picksRef.current[jjDayKey(student.id, activeDate)] }
          : {}),
      },
    };
  }
  /**
   * 저장·발송·글 복사 직전 — 템플릿 글 그대로(다시 짤 글)이고 그 템플릿에 그림 칸이 있으면, 인재원 하루치가 오래됐을 때
   * (JJ_FRESH_MS) 새로 받는다. 수업 전에 받아 둔 '시험 0건'으로 다시 짜여 결과지 줄이 빠진 채 나가지 않게(적대 리뷰 2026-09-11).
   * 서버는 글에 자리 줄이 **있을 때만** 자료를 묶으므로, 줄을 정하는 이 순간의 자료가 곧 발송물을 정한다.
   */
  async function refreshJjBeforeOutput(student: OneScreenStudent, subjectName: string): Promise<boolean> {
    const su = student.subjects.find((x) => x.name === subjectName);
    if (su?.subjectKey !== "english") return false;
    const rep = reportsRef.current[student.id]?.[subjectName];
    const found = findTemplate(rep?.templateId, englishTemplatesRef.current);
    if (!found || !canRecompose(found, rep)) return false;
    const slots = templateImageSlots(found);
    if (!slots.length) return false;
    // 템플릿이 쓰는 그림 칸이 '없음'으로 알려져 있으면 **항상 새로** 받는다 — 내용을 잃는 건 그 방향뿐이다(3분 안에 받아 둔
    // '시험 0건'이어도 방금 본 시험이 있을 수 있다, 적대 재리뷰). 있음·모름은 신선도 규칙(3분, 실패는 1분)대로.
    // 미연결은 '방금 본 시험'이 있을 수 없어 강제하지 않는다(행마다 서버를 한 번 더 부를 이유가 없다, 적대 재리뷰).
    const cached = jj.cacheRef.current[jjDayKey(student.id, activeDate)];
    const known = cached?.status === "ok" ? jjKnownSlots(cached) : null;
    const force = !!known && slots.some((k) => known[k] === false);
    await jj.ensure(student.id, { outOfClass: rowOutOfClass(student, su), force });
    return true;
  }
  /**
   * 기다린 뒤엔 **지금** 학생 값으로 저장한다 — 기다리는 동안 고친 칸이 빠지지 않게(적대 재리뷰 2026-09-11).
   * 그사이 그 과목 행이 사라졌으면 넘겨받은 학생 그대로(없는 행으로 과목·반이 빈 보고서를 만들지 않게).
   */
  function latestStudent(student: OneScreenStudent, subjectName: string): OneScreenStudent {
    const cur = studentsRef.current.find((s) => s.id === student.id);
    return cur && cur.subjects.some((su) => su.name === subjectName) ? cur : student;
  }
  // 보고서 저장 시 그 학생 진도를 확정 처리 — 표 모드엔 카드의 '진도 확정' 버튼이 없어 상단 진도·마감 지표가
  // 0에 고정되던 문제(#13). 이미 확정이면 no-op(불필요한 autosave 방지).
  function confirmProgressOnSave(studentId: string) {
    const cur = studentsRef.current.find((s) => s.id === studentId);
    if (cur && !cur.progressConfirmed) patch(studentId, (s) => ({ ...s, progressConfirmed: true }));
  }
  /**
   * 서버가 '영상 과제' 값을 작성 선생님 것으로 두었다(report-owner.ts — 나머지는 저장됨) → 화면도 그 값으로 되돌린다.
   * 🔴 안 되돌리면 세션(임시저장)이 내 값을 쥐고 있어 새로 고쳐도 같은 값이 다시 실린다(적대 리뷰). patch가 세션도 고친다.
   */
  function applyKeptVideoHomework(studentId: string, subjectName: string,
    res: { ok?: boolean; keptVideoHomework?: boolean | null; videoHomeworkCancelled?: true; videoHomeworkSeenAt?: string }) {
    if (res.keptVideoHomework === undefined) return;
    const kept = res.keptVideoHomework;
    const keptClassId = studentsRef.current.find((s) => s.id === studentId)?.subjects.find((x) => x.name === subjectName)?.classId;
    const cancelled = !!res.videoHomeworkCancelled;
    if (cancelled) {
      // 장부에서 취소된 숙제(원장 2026-10-16) — 줄은 잠그지 않는다(다시 켜면 그때부터 선생님 값이다). 그 줄의 맞춘 시각을 응답 시각으로 옮긴다.
      if (keptClassId && res.videoHomeworkSeenAt) videoHwStore?.markSeen(studentId, keptClassId, res.videoHomeworkSeenAt);
      // 발송 경로는 서버 문장("보내지 않았습니다")이 따로 뜬다 — 저장만 한 경로에서만 알린다.
      if (res.ok) toast.message(t("os.c.videoHwCancelled"));
    } else {
      // 화면 겹(토글 잠금)을 지나 여기 온 건 그사이 남이 먼저 쓴 경우뿐이라 드물다 — 일괄 저장이어도 행마다 알린다.
      toast.message(t("os.c.videoHwKept"));
      // 그 줄을 잠금에 더한다 — 열어 두면 다시 눌러 또 되돌려진다(잠긴 줄의 체크 표시는 공급자의 저장된 값).
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, kept);
    }
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) =>
        // 모름(null)은 화면 모양대로 undefined — 세션에서도 빠져 저장된 값(모름)을 따른다. 취소된 숙제는 마감 고르기도 비운다.
        x.name === subjectName ? { ...x, videoHomework: kept ?? undefined, ...(kept !== true ? { videoSubmitLink: false } : {}),
          ...(cancelled ? { videoHomeworkDue: undefined, videoHomeworkDueDate: undefined } : {}) } : x,
      ),
    }));
  }
  /**
   * 서버가 정한 영상 숙제 마감(원장 2026-10-15, due-write.ts) — '다음 수업' 날짜를 표시에 싣는다. 고른 것과 다르게 됐으면(7일로 됨 · 남이 쓴 줄)
   * 토글을 저장값으로 되돌리고 까닭을 학생 이름과 함께 알린다(일괄 저장이면 여러 줄이 뜬다 — 누구인지 보이게). 세션도 따라 고쳐진다
   * (고른 값이 남아 다음 저장에 또 실리지 않게). 남이 쓴 줄은 영상 과제와 같이 잠근다. 이 줄은 발송되지 않았다(saveAndQueueClassnote).
   */
  function applyVideoHomeworkDue(studentId: string, subjectName: string, res: { videoHomeworkDue?: SavedVideoHomeworkDue }) {
    const saved = res.videoHomeworkDue;
    if (!saved) return;
    const row = studentsRef.current.find((s) => s.id === studentId);
    const name = row?.name ?? "";
    if (saved.kept) {
      toast.message(tf("os.c.videoDueKept", { name }));
      const keptClassId = row?.subjects.find((x) => x.name === subjectName)?.classId;
      const keptVideo = row?.subjects.find((x) => x.name === subjectName)?.videoHomework;
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, keptVideo ?? null);
    } else if (saved.fellBack === "none") toast.message(tf("os.c.videoDueFallback", { name }));
    else if (saved.fellBack === "past") toast.message(tf("os.c.videoDuePast", { name, date: saved.missed ? monthDayLabel(saved.missed) : "" }));
    else if (saved.fellBack === "error") toast.error(tf("os.c.videoDueError", { name }));
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, videoHomeworkDue: saved.mode, videoHomeworkDueDate: saved.date ?? undefined } : x)),
    }));
  }
  // ── 저장·발송 코어(카드·표 공용) — (학생,과목) 저장/큐잉 + reports state 반영. ──
  async function saveRecord(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어(진입부들이 이미 막지만 새 진입부 대비) — 호출부가 res를 바로 쓰므로 실패 객체로 반환.
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    const res = await saveLessonReport(built.input);
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: false });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    if (res.ok) {
      notifyMakeupEffect(res.makeupEffect);
      // shareToken 보존 → report-card가 학부모 공개 링크(/r/[token])를 노출·복사. 기존 첨부·상태는 유지(merge).
      // 🔴 **초안은 건드리지 않는다** — 저장은 화면 값을 DB로 옮기는 일이지 멘트를 새로 쓰는 일이 아니다.
      //    예전엔 `built.draft`를 되써 넣었고, 멘트가 빈 행에선 그게 **템플릿을 몰래 채우는 통로**였다
      //    (buildSaveInputFor 주석 — 4일치 발송분 22%가 강사가 쓴 적 없는 문장이었다).
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
      }));
      confirmProgressOnSave(student.id); // 보고서 저장=진도 확정(표 모드엔 확정 버튼이 없어 지표 0 고정되던 문제, #13)
    }
    return res;
  }
  async function queueOne(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어 — saveRecord와 같은 이유(호출부 계약 유지: 실패 객체 반환).
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    let res = await saveAndQueueClassnote(built.input);
    // 반별 발송인데 보강 보고서의 보낼 반을 서버가 못 정했다(또는 보강 추가한 반에 반 보드가 없어 다른 반으로 가야 한다 —
    // 경고 한 줄과 함께 묻는다) — 강사가 고르면 그 반으로 다시 보낸다(저장은 이미 끝났다).
    if (res.status === "needs_class" && res.candidates?.length) {
      const picked = await askSendClass({
        studentName: student.name,
        candidates: res.candidates,
        defaultId: res.defaultClassId ?? null,
        makeupClassName: res.makeupClassName ?? null,
      });
      // 🔴 고른 반 = **새 보강 반**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 저장이 출석부 칸도 그 반으로 옮기고 그 반으로 보낸다.
      //    '보낼 반'만 따로 적는 길(`classnoteClassId`)은 없앴다 — 보고서 반과 출석부 반이 갈렸다.
      if (picked) {
        const pickedName = res.candidates.find((c) => c.id === picked)?.name ?? null;
        res = await saveAndQueueClassnote({ ...built.input, makeupClassId: picked });
        // 저장이 받아들였을 때만(반을 거절하면 오류 문장만 돌아온다 — id가 없거나 ok=false + 그 문장) 카드의 보강 반을 바꾼다.
        if (res.ok || (res.id && res.status !== undefined)) {
          patch(student.id, (s) => ({
            ...s,
            subjects: s.subjects.map((x) =>
              x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: pickedName ?? x.makeupClassName ?? null } : x,
            ),
          }));
        }
      }
    }
    // 작성 시간 기록(write-timing-store) — 저장된 보고서만(발송이 막혀도 저장됐으면 그때까지 쓴 시간이다).
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: res.ok });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    // 보낼 반 안내는 강사뷰 언어로(서버 문장은 한국어 폴백) — status로 사전 키를 고른다.
    notifyMakeupEffect(res.makeupEffect);
    const sendClassKey =
      res.status === "board_missing"
        ? "os.c.boardMissing"
        : res.status === "board_enrolling"
          ? "os.c.boardEnrolling"
          : res.status === "board_enrolling_auto"
            ? "os.c.boardEnrollingAuto"
            : res.status === "board_class_pending"
              ? "os.c.boardClassPending"
              : res.status === "board_hold_recheck"
              ? "os.c.boardHoldRecheck"
              : res.status === "board_hold"
                ? "os.c.boardHold"
                : res.status === "board_hold_admin"
                ? "os.c.boardHoldAdmin"
                : res.status === "board_left"
                  ? "os.c.boardLeft"
                  : res.status === "no_class"
                    ? "os.c.noSendClass"
                    : res.status === "needs_class"
                      ? "os.c.chooseSendClass"
                      : res.status === "class_check_failed"
                        ? "os.c.sendClassCheckFail"
                        : null;
    // 배정 보류 안내는 사유(연동 PC가 적은 문장)를 끼운다 — 나머지 문장엔 자리가 없어 그대로다.
    if (!res.ok && sendClassKey) res = { ...res, error: tf(sendClassKey, { reason: res.boardHoldReason ?? "" }) };
    // 서버가 그 반 동기화를 요청했다 — 몇 분 동안 C.N 아이콘을 짧은 주기로 다시 본다(배정되면 새로고침 없이 체크로 바뀐다).
    if (cnSyncRequested(res.status)) boostClassnoteMatch();
    if (res.ok) {
      // ⚠️ 응답 status에는 DB 상태가 아닌 **결과 코드**도 섞여 있다(dry_run·subject_off·absent·already_sent).
      //    그중 `already_sent`를 그대로 배지 state에 넣으면 "success가 아니게" 되어 발송 가드가 스스로 풀린다
      //    → 그 행의 **실제** DB 상태인 success로 되돌려 저장한다.
      const badgeStatus = res.status === "already_sent" ? "success" : res.status;
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
        classnoteStatus: badgeStatus,
      }));
      confirmProgressOnSave(student.id);
    } else if (res.id) {
      // 저장은 됐는데 **발송만** 막힌 경우(그림 자리뿐인 영어 글 등) — 저장된 상태·공유 링크는 반영한다(적대 재리뷰).
      patchReport(student.id, subjectName, (r) => ({ ...r, sent: true, shareToken: res.shareToken ?? r.shareToken }));
      confirmProgressOnSave(student.id); // 저장은 됐다 — saveRecord와 같은 규약(보고서 저장 = 진도 확정)
    }
    return res;
  }

  async function sendSubject(subjectName: string, channel: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 진도 미입력 게이트(방어층) — 버튼 disabled 우회·프로그램 호출 대비. 표뷰와 동일 기준(#15 확정).
    const su = selected.subjects.find((s) => s.name === subjectName);
    if (su && !isRowActionable(su, "save", undefined, { progressOptional: isProgressOptionalReport(su, reports[selected.id]?.[subjectName]) })) {
      toast.message(t("os.c.needProgress"));
      return;
    }
    // 영어 행 — AI 인사말·코멘트가 옛 값 기준이면 묻는다(학부모 링크·인쇄는 저장된 글을 그대로 보여 준다).
    if (!confirmEnglishOutput(selected, su, "os.tpl.outdatedSave")) return;
    const res = await saveRecord(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.saveFail"));
      return;
    }
    // 채널은 pdf(인쇄 미리보기 창)·save(기록 저장)뿐. 카톡·문자 자동발송(알림톡)은 후속 —
    // 지금은 저장 후 하단 '학부모 공유 링크' 복사로 수동 전달(별도 버튼 제거).
    if (channel === "pdf" && res.id) {
      openPrint({
        id: `print/lesson_reports/${res.id}`,
        href: `/lesson_reports/${res.id}/print`,
        title: t("os.c.printTitle"),
      });
      toast.success(tf("os.c.savedPreview", { subject: subjectName }));
    } else {
      toast.success(tf("os.c.savedRecord", { subject: subjectName }));
    }
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
  }

  // ClassNote 발송(카드) — 저장 + 큐 적재. 실제 게시는 로컬 워커가 백그라운드로(강사는 대기 안 함).
  async function queueClassnote(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 영어 행 — AI 코멘트가 고치기 전 값 기준이면 한 번 묻는다(표 행 발송·일괄 확인과 같은 판정, english-draft.ts).
    const suCard = selected.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(selected, suCard, "os.tpl.outdatedSend")) return;
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 표 sendRow와 동일. 워커 최종 관문이 무조건 차단하므로
    // 여기서 큐잉해 봐야 "발송 대기" 표시 후 실패로 뒤집히는 혼란만 남는다. 이유를 즉시 말하고 막는다.
    if (!hasTextBesidesMarkers(reports[selected.id]?.[subjectName]?.draft)) {
      toast.error(tf("os.c.emptyMentSubject", { subject: subjectName }));
      return;
    }
    const res = await queueOne(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.queueFail"));
      return;
    }
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
    if (res.status === "recall_pending") {
      toast.error(tf("os.c.recallingSubject", { subject: subjectName }));
      return;
    }
    if (res.status === "revoked") {
      toast.error(tf("os.c.revokedSubject", { subject: subjectName }));
      return;
    }
    if (res.status === "name_conflict") {
      toast.error(
        tf("os.c.nameConflictSubject", { subject: subjectName }),
      );
      return;
    }
    if (res.status === "dry_run") {
      // ClassNote 기능이 없는 학원 = 발송이라는 개념이 없다 → 그냥 "저장됨"(dry-run 문구 금지, 2026-09-30).
      toast.message(classnoteOn ? tf("os.c.dryRunSubject", { subject: subjectName }) : tf("os.c.savedRecord", { subject: subjectName }));
      return;
    }
    // 발송 대상 과목이 아님(원장 설정 classnoteSubjects 밖) — 저장만 되고 큐에 안 들어감. 성공으로 오인 방지.
    if (res.status === "subject_off") {
      toast.message(tf("os.c.subjectOff", { subject: subjectName }));
      return;
    }
    // '수업보고서 미발송' 반 게이트(서버판, 2026-08-19) — 여기서 안 잡으면 아래 폴스루가 "대기 중"
    // 성공 토스트를 띄운다(서버가 방금 거절한 발송을 성공으로 오인).
    if (res.status === "report_optout") {
      toast.message(tf("os.c.optoutSubject", { subject: subjectName, notice: reportOptoutNotice(lang) }));
      return;
    }
    // 결석 게이트(#77 서버판) — 버튼 disabled를 우회한 경로(반 모호 행·stale 화면)도 서버가 막는다.
    if (res.status === "absent") {
      toast.message(tf("os.c.absentSubject", { subject: subjectName }));
      return;
    }
    // 출결 미체크 게이트(서버판, 2026-08-17) — 여기서 안 잡으면 아래 폴스루가 "대기 중" 성공 토스트를
    // 띄운다(서버가 방금 거절한 발송을 성공으로 오인 — 적대 리뷰 확정). 표 sendRow와 동일 안내.
    if (res.status === "no_attendance") {
      toast.message(tf("os.c.uncheckedSubject", { subject: subjectName }));
      return;
    }
    // 이미 게시된 건(중복 게시 차단) — 저장도 안 했으므로 "내용을 고쳤다면 저장부터"를 함께 안내한다.
    if (res.status === "already_sent") {
      toast.message(
        tf("os.c.alreadySentSubject", { subject: subjectName }),
      );
      return;
    }
    const msg =
      res.status === "queued"
        ? res.sendWindowHint
          ? tf("os.c.queuedWindow", { hint: res.sendWindowHint })
          : t("os.c.queuedWaiting")
        : res.status === "success"
          ? t("os.c.statusSuccess")
          : res.status === "processing"
            ? t("os.c.statusProcessing")
            : res.status === "too_old"
              ? t("os.c.statusTooOld")
              : t("os.c.statusWaiting");
    toast.success(tf("os.c.queueResult", { subject: subjectName, msg }));
  }

  // ── 표(그리드) 행별/일괄 — 카드와 같은 코어(queueOne/saveRecord) 재사용. 오늘 진도 있는 행만. ──
  async function sendRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 워커 최종 관문이 무조건 차단하므로(빈 보고서가
    // 학부모에게 노출된 이날 사고) 여기서 보내봐야 실패 예약일 뿐이다. 이유를 즉시 말하고 막는다.
    if (!hasTextBesidesMarkers(reports[student.id]?.[subjectName]?.draft)) {
      toast.error(tf("os.c.emptyMentRow", { name: student.name }));
      return;
    }
    // 영어 행 — AI 코멘트가 고치기 전 값 기준이면 한 번 묻는다(카드 칩·표 칩·일괄 확인과 같은 판정, english-draft.ts).
    const suRow = student.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(student, suRow, "os.tpl.outdatedSend")) return;
    // 글에 적힌 영상 숙제 마감이 저장될 마감과 다르면 보내지 않는다(원장 2026-10-28, due-text-check.ts) — 서버도 같은 판정으로 한 번 더(#77).
    if (suRow?.videoHomework === true) {
      const dueGap = videoDueTextMismatch(
        reports[student.id]?.[subjectName]?.draft,
        expectedVideoDue(activeDate, suRow.videoHomeworkDue, suRow.videoHomeworkDueDate),
      );
      if (dueGap) {
        toast.error(tf("os.c.videoDueTextMismatch", { name: student.name, found: dueGap.found, expected: dueGap.expected }));
        return;
      }
    }
    const res = await queueOne(student, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.sendFail"));
      return;
    }
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
    if (res.status === "name_conflict") {
      toast.error(tf("os.c.nameConflictRow", { name: student.name }));
    } else if (res.status === "recall_pending") {
      toast.error(tf("os.c.recallingRow", { name: student.name }));
    } else if (res.status === "revoked") {
      toast.error(tf("os.c.revokedRow", { name: student.name }));
    } else if (res.status === "too_old") {
      toast.message(tf("os.c.tooOldRow", { name: student.name }));
    } else if (res.status === "dry_run") {
      toast.message(classnoteOn ? tf("os.c.dryRunRow", { name: student.name }) : tf("os.c.savedRow", { name: student.name }));
    } else if (res.status === "subject_off") {
      // 발송 대상 과목이 아님 — 저장만 됨. "발송 대기" 성공 오안내 방지(#2 확정).
      toast.message(tf("os.c.subjectOffRow", { name: student.name, subject: subjectName }));
    } else if (res.status === "report_optout") {
      // 미발송 반 게이트(서버판, 2026-08-19) — 화면 게이트를 지난 경로(stale 화면)도 서버가 막는다.
      toast.message(
        tf("os.c.optoutRow", {
          name: student.name,
          subject: subjectName,
          notice: reportOptoutNotice(lang),
        }),
      );
    } else if (res.status === "absent") {
      // 결석 게이트(#77 서버판) — 반 모호(attendanceRaw 미채움) 행 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(tf("os.c.absentRow", { name: student.name }));
    } else if (res.status === "no_attendance") {
      // 출결 미체크 게이트(서버판, 2026-08-17) — stale 화면 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(tf("os.c.uncheckedRow", { name: student.name }));
    } else if (res.status === "already_sent") {
      // 중복 게시 차단(서버판) — 화면 게이트를 지난 경로(stale 화면·다른 창에서 먼저 발송)도 서버가 막는다.
      toast.message(tf("os.c.alreadySentRow", { name: student.name, subject: subjectName }));
    } else if (res.status === "queued" && res.sendWindowHint) {
      // 발송 허용 시간창 밖 — 큐엔 정상 적재, 워커가 창 진입 시 자동 발송("왜 안 나가지?" 재발송 혼란 방지).
      toast.success(
        tf("os.c.queuedWindowRow", {
          name: student.name,
          subject: subjectName,
          hint: res.sendWindowHint,
        }),
      );
    } else {
      toast.success(tf("os.c.queuedRow", { name: student.name, subject: subjectName }));
    }
  }
  // 일괄 루프 중 학생·과목의 **최신** 스냅샷(ref) — 루프 중 편집을 반영하고 stale closure로 되돌리지 않게(#10).
  function latestRow(studentId: string, subjectName: string) {
    const student = studentsRef.current.find((s) => s.id === studentId);
    if (!student || !student.subjects.some((su) => su.name === subjectName)) return null;
    return student;
  }
  async function saveAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    const rows = selectRows("save", keys);
    const skipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    if (rows.length === 0) {
      // 발송 완료건은 수정 금지라 저장 대상에서도 빠진다 — "왜 아무것도 저장이 안 되지"의 답을 준다.
      toast.message(
        sentRowCount
          ? tf("os.c.saveNoneSent", { n: sentRowCount })
          : t("os.c.saveNone"),
      );
      return;
    }
    // 영어 행 중 AI 인사말·코멘트가 옛 값 기준인 행 — 저장하면 학부모 링크·인쇄에 그대로 보이니 **누구인지** 적고 묻는다.
    // 영어 행의 템플릿 목록이 아직 오는 중이면 잠깐 미룬다(곧 다시 짤 수 있게 된다 — 지금 '그대로'를 권하지 않는다).
    if (
      rows.some(
        (r) =>
          r.subject.subjectKey === "english" &&
          englishTemplateNotReady(reportsRef.current[r.student.id]?.[r.subject.name]),
      )
    ) {
      toast.message(t("os.tpl.loading"));
      return;
    }
    // 🔴 일괄 확인은 '확인됨'으로 적지 않는다 — 이름이 5명까지만 적히는 창 하나로 이후 행별 복사·발송 확인까지 꺼지면 안 된다.
    const outdatedRows = outdatedEnglishRows(rows);
    const aiStaleNames = [...new Set(outdatedRows.map((r) => r.student.name))];
    if (
      aiStaleNames.length &&
      !window.confirm(
        tf("os.tpl.bulkSaveOutdated", {
          n: aiStaleNames.length,
          names: aiStaleNames.slice(0, 5).join(", "),
          more: aiStaleNames.length > 5 ? tf("os.c.lineMore", { n: aiStaleNames.length - 5 }) : "",
        }),
      )
    )
      return;
    setBulkBusy("save");
    let ok = 0;
    let fail = 0;
    let jjWarn = 0; // 영어 그림 자료를 못 묶은 저장(저장은 성공) — 행마다 토스트를 쌓지 않고 한 줄로 센다
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await saveRecord(student, r.subject.name, "bulk");
        if (res.ok) ok++;
        else fail++;
        if (res.ok && res.warning) jjWarn++;
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      tf("os.c.saveDone", { n: ok }) +
        (fail ? tf("os.c.saveFailN", { n: fail }) : "") +
        (skipped ? tf("os.c.saveSkipped", { n: skipped }) : "") +
        (jjWarn ? tf("os.tpl.jjWarnBulk", { n: jjWarn }) : ""),
    );
  }
  async function sendAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    let rows = selectRows("send", keys); // ⚠️ let — 아래 빈 멘트 절대 가드가 대상을 좁힌다

    const preSkipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    // 발송 후보 중 **이미 발송된 행** — 아래 안내에 쓰고, rows에는 이미 빠져 있다.
    // ⚠️ 이 수치는 "일괄 발송을 다시 눌러도 안 나가는 이유"라 반드시 보여준다(무언 제외 = 사고 은폐).
    // ⚠️ `selectRows`로 세면 **항상 0**이 된다 — 발송 완료건은 save 게이트에서도 이미 빠지기 때문
    //    (2026-07-22 '수정도 금지'로 강화된 뒤의 함정). 그래서 게이트 이전의 원본 행에서 센다.
    const allRows = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = keys?.length ? new Set(keys) : null;
    const alreadySentRows = allRows.filter(
      (r) =>
        (!keySet || keySet.has(r.key)) &&
        r.subject.attendanceRaw !== "absent" &&
        isAlreadySent(effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus)),
    ).length;
    if (rows.length === 0) {
      toast.message(
        alreadySentRows
          ? tf("os.c.sendNoneSent", { n: alreadySentRows })
          : t("os.c.sendNone"),
      );
      return;
    }
    // 발송 전 누락 안내(2-4) — 차단 아님("누락=생략" 철학 유지). 누락은 고유 학생 수 기준.
    // ⚠️ 결석 제외는 **행(과목) 단위 건수** — 다과목 학생은 결석 반 과목만 빠지고 다른 과목은 발송되므로
    //    "N명 제외"로 쓰면 오안내(리뷰 확정). 발송 단위=행(lesson_reports 1건)이라 "건"이 정확.
    const absentRows = allRows.filter(
      (r) => (!keySet || keySet.has(r.key)) && r.subject.attendanceRaw === "absent",
    ).length;
    // 진도 미입력 제외(2026-07-28 김민찬 사례) — 멘트까지 다 써놓고 진도만 빠진 행이 **소리 없이** 빠지면
    // 강사는 발송된 줄 알고, 학부모는 못 받는다. 제외라는 사실 + **누구인지**를 confirm에서 알린다.
    const noProgressRows = allRows.filter(
      (r) =>
        (!keySet || keySet.has(r.key)) &&
        r.subject.attendanceRaw !== "absent" &&
        !isAlreadySent(effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus)) &&
        !isReportEligible(r.subject, isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name])),
    );
    const noProgressNames = [...new Set(noProgressRows.map((r) => r.student.name))];
    const progressLine = noProgressRows.length
      ? tf("os.c.lineProgress", {
          n: noProgressRows.length,
          names: noProgressNames.slice(0, 5).join(", "),
          more:
            noProgressNames.length > 5
              ? tf("os.c.lineMore", { n: noProgressNames.length - 5 })
              : "",
        })
      : "";
    // 출결 미체크 제외(2026-08-17 원장 지시) — 진도·멘트와 같은 규약: 소리 없는 제외 금지, 누구인지 명시.
    // "미체크만 아니면 발송됐을 행" = autowrite 판정(진도 있음·미발송·결석 아님)과 정확히 같은 집합이라
    // 게이트 함수를 재사용한다(조건 체인을 손으로 복제하면 게이트가 바뀔 때 이 카운트만 조용히 어긋난다, #89류).
    // 진도 미입력 행은 위 progressLine이 이미 셌으므로 여기 안 겹친다(한 행 중복 계수 방지).
    const uncheckedRows = allRows.filter(
      (r) =>
        canEditAttendance && // 출결 쓰기 권한 없음 = 게이트 해당 없음(P0-3) — 제외 안내도 하지 않는다
        (!keySet || keySet.has(r.key)) &&
        isRowActionable(r.subject, "autowrite", effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus), {
          progressOptional: isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name]),
        }) &&
        isAttendanceUnchecked(r.subject),
    );
    const uncheckedNames = [...new Set(uncheckedRows.map((r) => r.student.name))];
    const uncheckedLine = uncheckedRows.length
      ? tf("os.c.lineUnchecked", {
          n: uncheckedRows.length,
          names: uncheckedNames.slice(0, 5).join(", "),
          more:
            uncheckedNames.length > 5
              ? tf("os.c.lineMore", { n: uncheckedNames.length - 5 })
              : "",
        })
      : "";
    const gaps = summarizeSendGaps(rows, { dailyEnabled: showDailyTest, checkEnabled: showCheckTest });
    const gapLine =
      gaps.missingAttitude || gaps.missingTest
        ? tf("os.c.lineGap", { attitude: gaps.missingAttitude, test: gaps.missingTest })
        : "";
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 멘트 없는 행은 **발송 대상에서 제외**한다(워커
    // 최종 관문도 무조건 차단 — 이날 빈 보고서 22건이 학부모에게 노출된 사고). confirm에 누구인지 명시.
    // 영어 글의 그림·사진 자리 줄뿐인 행도 빈 멘트다(서버 isSlotOnlyEnglishNotes와 같은 판정 — hasTextBesidesMarkers).
    const emptyMentRows = rows.filter((r) => !hasTextBesidesMarkers(reports[r.student.id]?.[r.subject.name]?.draft));
    rows = rows.filter((r) => hasTextBesidesMarkers(reports[r.student.id]?.[r.subject.name]?.draft));
    const emptyMentNames = [...new Set(emptyMentRows.map((r) => r.student.name))];
    const emptyMentLine = emptyMentRows.length
      ? tf("os.c.lineMent", {
          n: emptyMentRows.length,
          names: emptyMentNames.slice(0, 5).join(", "),
          more:
            emptyMentNames.length > 5
              ? tf("os.c.lineMore", { n: emptyMentNames.length - 5 })
              : "",
        })
      : "";
    // 새 보고서 조건(자동작성 다시 · 사랑의 한마디 · 시험 없음/숙제 미제출 사유) — 행별 발송 버튼과 **같은 판정**(pilot-send-gate.ts).
    // 원장 2026-10-26 *"표로 일괄입력할 때 문제"* — 일괄 발송만 이 조건을 안 봐서 사유 없는 글·옛 출결이 적힌 글이 나갔다. 제외 + 누구인지.
    const pilotBlockedRows = rows.filter((r) => pilotSendBlocks(latestRow(r.student.id, r.subject.name) ?? r.student, r.subject.name, reportsRef.current[r.student.id]?.[r.subject.name]).length > 0);
    if (pilotBlockedRows.length) {
      const blockedKeys = new Set(pilotBlockedRows.map((r) => r.key));
      rows = rows.filter((r) => !blockedKeys.has(r.key));
    }
    // 보강 진행 여부 확인 전 줄 — 행별 발송 버튼은 막는데(send-gate `mkcheck`) 일괄 발송만 안 걸러 서버 거절이 '실패'로 섞였다
    //   (2026-10-27 표 일괄 점검). 버튼과 **같은 판정**(needsMakeupCheck)으로 미리 빼고 누구인지 알린다.
    const makeupBlockedRows = rows.filter((r) => {
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return needsMakeupCheck(st.subjects.find((s) => s.name === r.subject.name) ?? r.subject);
    });
    if (makeupBlockedRows.length) {
      const blockedKeys = new Set(makeupBlockedRows.map((r) => r.key));
      rows = rows.filter((r) => !blockedKeys.has(r.key));
    }
    const makeupBlockedNames = [...new Set(makeupBlockedRows.map((r) => r.student.name))];
    const makeupLine = makeupBlockedRows.length
      ? tf("os.c.lineMakeupCheck", {
          n: makeupBlockedRows.length,
          names: makeupBlockedNames.slice(0, 5).join(", "),
          more: makeupBlockedNames.length > 5 ? tf("os.c.lineMore", { n: makeupBlockedNames.length - 5 }) : "",
        })
      : "";
    const pilotBlockedNames = [...new Set(pilotBlockedRows.map((r) => r.student.name))];
    const pilotLine = pilotBlockedRows.length
      ? tf("os.c.linePilot", {
          n: pilotBlockedRows.length,
          names: pilotBlockedNames.slice(0, 5).join(", "),
          more: pilotBlockedNames.length > 5 ? tf("os.c.lineMore", { n: pilotBlockedNames.length - 5 }) : "",
        })
      : "";
    if (rows.length === 0) {
      if (pilotBlockedRows.length || makeupBlockedRows.length) toast.message(`${t("os.c.sendNone")}${pilotLine}${makeupLine}`);
      else toast.message(tf("os.c.sendNoneMent", { n: emptyMentRows.length }));
      return;
    }
    // 영어 행 중 AI 코멘트가 고치기 전 값으로 쓰인 행 — 막지 않고 **누구인지** 알린다(위 줄들과 같은 규약).
    // 저장 직전 재조립은 사실 줄만 새로 쓰므로, 여기서 안 알리면 점수와 코멘트가 서로 다른 글이 나간다.
    // 영어 행의 템플릿 목록이 아직 오는 중이면 잠깐 미룬다(곧 다시 짤 수 있게 된다 — 지금 '그대로'를 권하지 않는다).
    if (
      rows.some(
        (r) =>
          r.subject.subjectKey === "english" &&
          englishTemplateNotReady(reportsRef.current[r.student.id]?.[r.subject.name]),
      )
    ) {
      toast.message(t("os.tpl.loading"));
      return;
    }
    // 🔴 일괄 확인은 '확인됨'으로 적지 않는다 — 이름이 5명까지만 적히는 창 하나로 이후 행별 복사·발송 확인까지 꺼지면 안 된다.
    const outdatedRows = outdatedEnglishRows(rows);
    const aiStaleNames = [...new Set(outdatedRows.map((r) => r.student.name))];
    const aiStaleLine = aiStaleNames.length
      ? tf("os.tpl.lineOutdated", {
          n: aiStaleNames.length,
          names: aiStaleNames.slice(0, 5).join(", "),
          more: aiStaleNames.length > 5 ? tf("os.c.lineMore", { n: aiStaleNames.length - 5 }) : "",
        })
      : "";
    const absentLine = absentRows ? tf("os.c.lineAbsent", { n: absentRows }) : "";
    const sentLine = alreadySentRows
      ? tf("os.c.lineSent", { n: alreadySentRows })
      : "";
    if (
      !window.confirm(
        tf("os.c.sendConfirm", {
          n: rows.length,
          lines: `${emptyMentLine}${pilotLine}${makeupLine}${progressLine}${uncheckedLine}${gapLine}${aiStaleLine}${absentLine}${sentLine}`,
        }),
      )
    )
      return;
    setBulkBusy("send");
    let queued = 0;
    let blocked = 0;
    let skipped = 0;
    let subjectOff = 0; // 발송 대상 과목 아님(저장만) — '발송 대기'로 뭉뚱그리지 않고 명시(#2 확정)
    let absentSkip = 0; // 서버 결석 게이트에 걸린 행(클라 사전 필터의 사각 — 반 모호 행 등)
    let uncheckedSkip = 0; // 서버 출결 미체크 게이트에 걸린 행(stale 화면 등 클라 게이트 사각)
    let optoutSkip = 0; // 서버 '수업보고서 미발송' 반 게이트에 걸린 행(2026-08-19)
    let sentSkip = 0; // 서버 중복 게시 가드에 걸린 행(다른 창에서 먼저 보낸 경우 등)
    let dry = 0;
    let fail = 0;
    let noClass = 0; // 반별 발송인데 보낼 반이 없어 막힌 행(원장 2026-09-30 — 담당 반이 없으면 발송 불가)
    let boardWait = 0; // 반 보드 배정·재확인을 기다리는 행(방금 배정된 신입 등 — 배정된 뒤 다시 보내면 된다, 2026-10-03)
    let jjWarn = 0; // 영어 그림 자료를 못 묶은 행(저장은 성공)
    let makeupSkip = 0; // 보강 진행 여부 확인 전이라 서버가 거절한 행(저장은 됐다)
    let pilotSkip = 0; // 새 보고서 조건(자동작성·사랑의 한마디·사유)에 걸려 서버가 거절한 행 — 화면 판정 뒤에 값이 바뀐 경우
    let windowHint = ""; // 발송 허용 시간창 밖 큐잉 — 마지막 응답의 창 라벨(테넌트 단일 설정이라 동일)
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await queueOne(student, r.subject.name, "bulk");
        if (res.ok && res.warning) jjWarn++;
        if (!res.ok) {
          // 반 보드에 배정되는 중이면 '실패'가 아니라 '기다림'으로 센다. 보류·반을 떠난 학생은 보낼 반이 없는 것이다.
          if (isBoardWaitStatus(res.status)) boardWait++;
          else if (res.status === "no_class" || isBoardBlockedStatus(res.status)) noClass++;
          // 새 보고서 조건에 걸려 서버가 거절(저장은 됐다) — '실패'로 뭉치지 않고 이유를 따로 센다(원장 2026-10-26).
          else if (isPilotGateError(res.error)) pilotSkip++;
          // 보강 진행 여부 확인 전(화면 판정 뒤에 예약이 생긴 경우 등) — 서버가 거절, 저장은 됐다.
          else if (res.error === MAKEUP_CHECK_REQUIRED_ERROR) makeupSkip++;
          else fail++;
        } else if (res.status === "queued") {
          queued++;
          if (res.sendWindowHint) windowHint = res.sendWindowHint;
        } else if (res.status === "dry_run") dry++;
        else if (res.status === "subject_off") subjectOff++;
        else if (res.status === "name_conflict" || res.status === "revoked" || res.status === "recall_pending") blocked++;
        else if (res.status === "absent") absentSkip++; // 서버 결석 게이트(클라 사전 필터를 지난 반 모호 행 등)
        else if (res.status === "no_attendance") uncheckedSkip++; // 서버 출결 미체크 게이트(stale 화면 등)
        else if (res.status === "report_optout") optoutSkip++; // 서버 미발송 반 게이트(2026-08-19)
        else if (res.status === "already_sent") sentSkip++; // 서버 중복 게시 가드(클라 게이트를 지난 stale 행)
        else skipped++; // processing/too_old
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      (dry ? (classnoteOn ? tf("os.c.bulkDry", { n: dry }) : tf("os.c.bulkSavedOnly", { n: dry })) : "") +
        (!classnoteOn && queued === 0
          ? ""
          : windowHint
            ? tf("os.c.bulkQueuedWindow", { n: queued, hint: windowHint })
            : tf("os.c.bulkQueued", { n: queued })) +
        (subjectOff ? tf("os.c.bulkSubjectOff", { n: subjectOff }) : "") +
        (absentSkip ? tf("os.c.bulkAbsent", { n: absentSkip }) : "") +
        (uncheckedSkip ? tf("os.c.bulkUnchecked", { n: uncheckedSkip }) : "") +
        (optoutSkip ? tf("os.c.bulkOptout", { n: optoutSkip }) : "") +
        (alreadySentRows || sentSkip
          ? tf("os.c.bulkSent", { n: alreadySentRows + sentSkip })
          : "") +
        (blocked ? tf("os.c.bulkBlocked", { n: blocked }) : "") +
        (skipped ? tf("os.c.bulkSkipped", { n: skipped }) : "") +
        (preSkipped ? tf("os.c.bulkPreSkipped", { n: preSkipped }) : "") +
        (jjWarn ? tf("os.tpl.jjWarnBulk", { n: jjWarn }) : "") +
        (boardWait ? tf("os.c.bulkBoardWait", { n: boardWait }) : "") +
        (noClass ? tf("os.c.bulkNoClass", { n: noClass }) : "") +
        (pilotSkip ? tf("os.c.bulkPilot", { n: pilotSkip }) : "") +
        (makeupSkip ? tf("os.c.bulkMakeupCheck", { n: makeupSkip }) : "") +
        (fail ? tf("os.c.bulkFail", { n: fail }) : ""),
    );
  }

  // 공유링크 취소(revoke) — 학부모 열람 즉시 차단. 대상은 그 과목의 현재 shareToken.
  async function revokeShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    const student = selected;
    const res = await revokeShareLink(token);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.revokeFail"));
      return;
    }
    patchReport(student.id, subjectName, (r) => ({ ...r, revoked: true }));
    toast.success(tf("os.c.revoked", { subject: subjectName }));
  }

  // 공유링크 재발급(reissue) — 새 토큰. 옛 링크(카톡/문자/ClassNote 게시)는 즉시 무효화되므로 확인 후 실행.
  async function reissueShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    if (!window.confirm(t("os.c.reissueConfirm"))) return;
    const student = selected;
    const res = await reissueShareLink(token);
    if (!res.ok || !res.shareToken) {
      toast.error(res.error ?? t("os.c.reissueFail"));
      return;
    }
    // 새 토큰 반영 + 취소·ClassNote 상태 초기화(재발급=미발송으로 되돌림).
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      shareToken: res.shareToken,
      revoked: false,
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
    }));
    toast.success(tf("os.c.reissued", { subject: subjectName }));
  }

  // ── 학생 사진 첨부(P2b) — 저장된 보고서에만(서버 강제). subject는 DB 저장키(subjectKey)로 넘긴다. ──
  // ⚠️ 첨부 핸들러는 **(학생, 과목) 파라미터**가 원형이고 카드는 selected를 감싸 부른다(표=행별 직접 호출) —
  //    진도·점수 핸들러와 같은 "로직 단일 소스" 규약. 표 첨부(클립·드롭·일괄)가 이 경로를 그대로 쓴다.
  const subjectKeyFor = (student: OneScreenStudent, subjectName: string): string | undefined => {
    const su = student.subjects.find((s) => s.name === subjectName);
    return su?.subjectKey || su?.subjectLabel || su?.name || undefined;
  };
  // 첨부가 붙을 **행(반)** — 보고서 단위가 반이라(0134a) 과목만 넘기면 정규/특강 중 아무 행에나 붙는다.
  const classIdFor = (student: OneScreenStudent, subjectName: string): string | null =>
    student.subjects.find((s) => s.name === subjectName)?.classId ?? null;

  // 선택 학생 과목별 첨부 path 시그니처 — 경로 변경 시에만 썸네일 URL 재요청(draft 편집엔 재요청 안 함).
  const attTargets = selected
    ? selected.subjects
        .map((su) => ({
          subject: su.subjectKey || su.subjectLabel || su.name || undefined,
          // 반(0134a) — 같은 과목 두 행이면 과목만으론 어느 보고서의 첨부인지 못 가른다.
          classId: su.classId ?? null,
          paths: (reports[selected.id]?.[su.name]?.attachments ?? []).map((a) => a.path),
        }))
        .filter((t) => t.paths.length > 0)
    : [];
  const attSig = attTargets.map((t) => `${t.classId ?? t.subject ?? ""}:${t.paths.join(",")}`).join("|");
  useEffect(() => {
    // attTargets 없으면 재요청 안 함(기존 map은 path 키라 stale해도 오표시 없음 — 신규 서명 시 전체 교체).
    if (!selected || attTargets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const merged: Record<string, string> = {};
      for (const t of attTargets) {
        const res = await signReportAttachmentUrls({
          studentId: selected.id,
          subject: t.subject,
          classId: t.classId,
          reportDate: date || undefined,
        });
        if (res.urls) Object.assign(merged, res.urls);
      }
      if (!cancelled) setAttUrls(merged);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attSig가 attTargets 내용을 대표(경로 변경 시에만 재요청)
  }, [selected?.id, attSig]);

  // 파일별 순차 업로드(register read-modify-write clobber 방지). issue→uploadToTicket→register.
  // 카드(selected)·표(행별)·일괄 첨부가 **모두 이 함수 하나**를 쓴다 — 게이트·저장보장·상태리셋이 갈라지지 않게.
  async function addAttachmentsFor(
    student: OneScreenStudent,
    subjectName: string,
    files: File[],
    opts?: { silent?: boolean }, // 일괄 첨부 — 행마다 토스트를 띄우면 10행이면 10개가 쌓인다(요약 1개로)
  ): Promise<number> {
    if (readonlyView) {
      if (!opts?.silent) toast.error(READONLY_TEACHER_VIEW_ERROR); // 일괄(bulkAttach)은 진입부가 이미 알렸다
      return 0;
    }
    // 미저장 첨부는 buildSaveInput으로 보고서 행을 먼저 만든다 — 진도 없으면 빈 보고서가 생기므로 게이트(#15).
    const su0 = student.subjects.find((s) => s.name === subjectName);
    if (su0 && !reports[student.id]?.[subjectName]?.sent && !isRowActionable(su0, "save", undefined, { progressOptional: isProgressOptionalReport(su0, reports[student.id]?.[subjectName]) })) {
      if (!opts?.silent) toast.message(t("os.c.attachNeedProgress"));
      return 0;
    }
    // 영어 행 — 첫 첨부는 지금 글로 보고서를 자동 저장한다(저장된 글은 학부모 링크·인쇄에 그대로 보인다). 글이 고치기 전
    // 값을 담고 있으면 발송·저장과 같은 판정으로 묻고, 일괄(조용히)은 그 행을 건너뛴다(요약의 '건너뜀'에 잡힌다).
    if (!reports[student.id]?.[subjectName]?.sent && su0?.subjectKey === "english") {
      if (opts?.silent) {
        if (englishRowFlags(student, su0, reportsRef.current[student.id]?.[subjectName]).outdated) return 0;
      } else if (!confirmEnglishOutput(student, su0, "os.tpl.outdatedSave")) return 0;
    }
    const studentId = student.id;
    const subject = subjectKeyFor(student, subjectName);
    setUploadingAttKey(rowKey(studentId, subjectName));
    let added = 0;
    try {
      // 첨부 먼저 UX — 미저장 상태면 현재 초안으로 자동저장해 보고서 행을 먼저 만든다(첨부는 저장된 행에만).
      // 수동 '저장' 클릭을 없앨 뿐 결과는 "저장 후 첨부"와 동일(진짜 저장된 행).
      if (!reports[studentId]?.[subjectName]?.sent) {
        const waited = await refreshJjBeforeOutput(student, subjectName);
        const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
        if (!built) {
          toast.error(t("os.c.attachNoInfo"));
          return 0;
        }
        const saved = await saveLessonReport(built.input);
        applyKeptVideoHomework(studentId, subjectName, saved);
        applyVideoHomeworkDue(studentId, subjectName, saved);
        if (!saved.ok || !saved.id) {
          toast.error(saved.error ?? t("os.c.saveFail"));
          return 0;
        }
        // 영어 그림 자료를 못 묶었으면 여기서도 알린다 — 첨부가 저장을 대신했을 뿐 같은 사실이다(적대 재리뷰).
        // 일괄 첨부(silent)는 행마다 띄우지 않는다(인재원이 멈추면 토스트가 쏟아진다).
        if (saved.warning && !opts?.silent) toast.message(saved.warning);
        notifyMakeupEffect(saved.makeupEffect);
        // 초안은 화면 값 그대로 둔다(위 saveRecord와 같은 이유 — 저장이 멘트를 쓰지 않는다).
        patchReport(studentId, subjectName, (r) => ({
          ...r,
          sent: true,
          shareToken: saved.shareToken ?? r.shareToken,
        }));
      }
      for (const original of files) {
        // 이미지만 업로드 전 클라 다운스케일(문서/오디오는 원본 그대로). 실패 시 원본 반환이라 업로드는 항상 진행.
        const file = original.type.startsWith("image/") ? await resizeImageForUpload(original) : original;
        const ext = extFromType(file.type) ?? file.name.split(".").pop() ?? "jpg";
        const issued = await issueReportAttachmentUploadTicket({
          studentId,
          subject,
          classId: classIdFor(student, subjectName), // 그 반 보고서에만 붙인다(0134a)
          reportDate: date || undefined, // 과거 날짜 첨부가 '오늘' 행에 붙지 않게 대상 날짜 명시(#5 확정)
          contentType: file.type,
          size: file.size,
          ext,
        });
        if (issued.error || !issued.ticket) {
          toast.error(issued.error ?? t("os.c.attachIssueFail"));
          break;
        }
        try {
          await uploadToTicket(issued.ticket, file);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("os.c.attachUploadFail"));
          break;
        }
        const reg = await registerReportAttachment({
          studentId,
          subject,
          classId: classIdFor(student, subjectName),
          reportDate: date || undefined,
          path: issued.ticket.path,
          name: original.name,
          size: file.size,
        });
        if (!reg.ok) {
          toast.error(reg.error ?? t("os.c.attachRegisterFail"));
          break;
        }
        added++;
        // 첨부 변경 시 서버가 classnote 상태 리셋 → UI 배지도 클리어(재발송 유도).
        patchReport(studentId, subjectName, (r) => ({
          ...r,
          attachments: reg.attachments ?? r.attachments,
          classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
        }));
      }
      if (added) {
        if (!opts?.silent) toast.success(tf(classnoteOn ? "os.c.attachDone" : "os.c.attachDoneLink", { n: added }));
        void ensureAttachmentUrls(student, subjectName); // 표 팝오버 썸네일(카드는 아래 서명 이펙트가 갱신)
      }
    } finally {
      setUploadingAttKey(null);
    }
    return added;
  }
  /** 카드(선택 학생) 래퍼 — 표는 addAttachmentsFor를 행별로 직접 부른다. */
  const addAttachments = (subjectName: string, files: File[]) =>
    selected ? addAttachmentsFor(selected, subjectName, files) : Promise.resolve();

  /**
   * 영어 글 속 사진·PDF(2026-09-11, 사용자 선택 "글 속 원하는 자리에") — 올린 뒤 **커서가 있던 줄**에 `[첨부: 이름]` 줄을 넣는다.
   * 이름은 그 보고서 첨부와 겹치지 않게 정한다(자리 줄이 이름으로 첨부를 찾는다 — attachment-utils.ts). 올리기·저장 보장·게이트는
   * 카드·표와 **같은 함수**(addAttachmentsFor)다. 🔴 못 올렸으면 줄을 넣지 않는다(가리킬 파일이 없는 줄).
   * ⚠️ 줄은 글(초안)에 들어간다 — 다른 글 고치기처럼 저장·발송·PDF가 저장할 때 학부모 글에 실린다(그 셋은 늘 먼저 저장한다).
   */
  async function insertEnglishMediaFor(student: OneScreenStudent, subjectName: string, file: File) {
    if (readonlyBlocked()) return;
    // 커서 줄 — 파일을 고르고 자르는 동안에도 글칸은 마지막 커서를 기억한다(초점이 빠져도 selectionStart는 남는다).
    const el = document.getElementById(ENGLISH_DRAFT_TEXTAREA_ID);
    const before = reportsRef.current[student.id]?.[subjectName];
    const draft0 = before?.draft ?? "";
    // 이름은 지금 첨부 **와 글 속 자리 줄** 둘 다와 겹치지 않게 — 다른 화면에서 지운 첨부의 줄이 남아 있으면 새 사진이 그 옛
    // 자리에 서고 새 줄은 무시된다(적대 리뷰 2026-09-11).
    const name = uniqueAttachmentName(file.name, [
      ...(before?.attachments ?? []).map((a) => a.name),
      ...usedAttachmentNames(draft0),
    ]);
    // 자리는 **줄 내용**으로 기억한다(attachment-lines.ts) — 첫 첨부의 자동 저장이 글을 다시 짜거나 올리는 동안 강사가 계속 써도
    // 같은 윗줄 아래에 선다(줄 번호로만 기억하면 머리말과 내용 사이로 갔다 — 적대 리뷰 2026-09-11).
    // 글 칸은 맨 위 '수업 평가' 표를 뗀 본문만 보인다(2026-10-26) — 칸의 커서 위치에 뗀 길이(data-caret-offset)를 더해 전체 글 기준으로.
    const caret = el instanceof HTMLTextAreaElement ? el.selectionStart + (Number(el.dataset.caretOffset) || 0) : null;
    const placed = insertAttachmentLine(draft0, attachmentLineIndex(draft0, caret), name);
    const named = name === file.name ? file : new File([file], name, { type: file.type });
    const added = await addAttachmentsFor(student, subjectName, [named]);
    if (!added) return;
    patchReport(student.id, subjectName, (r) => ({ ...r, draft: carryAttachmentLines(placed, r.draft, { only: name }) }));
  }

  async function removeAttachmentFor(student: OneScreenStudent, subjectName: string, path: string) {
    if (readonlyBlocked()) return;
    const studentId = student.id;
    // 영어 글 속 그 첨부의 자리 줄도 함께 지운다(아래) — 지우기 **전** 이름과 '그 줄이 가리키던 첨부'를 잡아 둔다.
    // 자리 줄은 이름이 같은 **첫** 첨부를 가리킨다(pickInlineAttachments) — 지운 게 그 첨부였을 때만 줄을 지운다
    // (남겨 두면 같은 이름의 다른 첨부를 조용히 가리키게 된다 — 적대 리뷰 2026-09-11).
    const list = reportsRef.current[studentId]?.[subjectName]?.attachments ?? [];
    const removedName = list.find((a) => a.path === path)?.name;
    const pointedHere = !!removedName && list.find((a) => a.name === removedName)?.path === path;
    const englishRow = student.subjects.find((x) => x.name === subjectName)?.subjectKey === "english";
    const res = await removeReportAttachment({
      studentId,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
      path,
    });
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.attachDeleteFail"));
      return;
    }
    const dropLine = englishRow && pointedHere;
    patchReport(studentId, subjectName, (r) => ({
      ...r,
      attachments: res.attachments ?? [],
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
      // 가리킬 파일이 없는 대괄호 줄을 글칸에 남기지 않는다(카드는 어차피 안 그린다).
      ...(dropLine && removedName ? { draft: removeAttachmentLines(r.draft, removedName) } : {}),
    }));
    setAttUrls((prev) => {
      const n = { ...prev };
      delete n[path];
      return n;
    });
    toast.success(t("os.c.attachDeleted"));
  }
  const removeAttachment = (subjectName: string, path: string) =>
    selected ? removeAttachmentFor(selected, subjectName, path) : Promise.resolve();

  /** 표 팝오버용 썸네일 서명 — 카드처럼 상시 서명하지 않고 **열 때만** 1회(행 수만큼 서명하면 낭비). */
  async function ensureAttachmentUrls(student: OneScreenStudent, subjectName: string) {
    const atts = reportsRef.current[student.id]?.[subjectName]?.attachments ?? [];
    if (atts.length === 0) return;
    const res = await signReportAttachmentUrls({
      studentId: student.id,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
    });
    if (res.urls) setAttUrls((prev) => ({ ...prev, ...res.urls }));
  }

  /**
   * 선택 행 일괄 첨부 — 같은 사진/파일(시험지·판서)을 여러 학생 행에 한 번에.
   * 행마다 **순차** 처리(register가 read-modify-write라 병렬이면 서로 덮어쓴다). 게이트·저장보장은 행 단위 동일.
   */
  async function bulkAttach(keys: string[], files: File[]) {
    if (readonlyBlocked()) return;
    if (!files.length) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10과 같은 규약)
    const targets = keys
      .map((k) => {
        const [studentId, subjectName] = k.split("::");
        const student = studentsRef.current.find((s) => s.id === studentId);
        return student && subjectName ? { student, subjectName } : null;
      })
      .filter((t): t is { student: OneScreenStudent; subjectName: string } => !!t);
    if (!targets.length) return;
    setBulkBusy("save");
    let rows = 0;
    let added = 0;
    try {
      for (const t of targets) {
        const n = await addAttachmentsFor(t.student, t.subjectName, files, { silent: true });
        if (n > 0) {
          rows++;
          added += n;
        }
      }
    } finally {
      setBulkBusy(null);
    }
    // 요약 1개 — 건너뛴 행(진도 미입력·상한 초과)이 있으면 숫자로 드러난다.
    if (rows === 0) toast.message(t("os.c.attachNoRow"));
    else {
      const skipped = targets.length - rows;
      toast.success(
        tf("os.c.attachBulk", { rows, n: added }) +
          (skipped ? tf("os.c.attachBulkSkip", { n: skipped }) : "") +
          (classnoteOn ? t("os.c.attachBulkTail") : ""),
      );
    }
  }

  const reportGrid = (
<OneScreenGrid
          readonlyView={readonlyView}
          students={visible}
          bulkPresent={bulkPresentProps}
          reports={reports}
          config={{
            attitudes: ATTITUDE,
                  allowTestMax: allowTeacherTestMax,
            dailyEnabled: showDailyTest,
            checkEnabled: showCheckTest,
            attachmentUrls: attUrls,
            attachmentsHidden: !showAttachments,
            // 멘트 모드는 카드 모드와 **같은 실효값**을 쓴다(강사 오버라이드 > 학원 기본) — 표 모드만
            // 단일 칸으로 남으면 토글을 B로 둔 강사가 "표에선 적용이 안 된다"고 느낀다(원장 제보 2026-07-21).
            noticeMode: noticeMode ?? academyNoticeMode,
            classnoteMatch: liveClassnoteMatch,
            holidayName,
          }}
          fields={{
            onAttendance: setAttendanceFor,
            onProgress: setProgressFor,
            onProgressMode: setProgressModeFor,
            onUnderstandingAll: setAllUnderstandingFor, // 표에서도 카드와 같은 이해도 단계 버튼(2026-10-26)
            // 소단원별 점수·빼기 — 카드 패널과 같은 setter(원장 2026-10-27 *"학생별 상세에서 각각 변하게"*).
            onUnderstandingScore: setUnderstandingScoreFor,
            onUnderstandingToggle: toggleUnderstandingFor,
            onStudyGrade: setStudyGradeFor,
            onScore: setScoreFor,
            onMax: setMaxFor,
            onAttitude: setAttitudeValue,
            onHomework: setHomeworkValue,
            onTextbook: setTextbookFor,
            onHomeworkToday: setHomeworkTodayFor,
            onDraft: setDraftFor,
            onTrend: setTrendDraftFor,
            trendHidden: isTrendHiddenFor,
            onTrendHidden: toggleTrendHiddenFor,
            onNote: setNoteFor,
            onMakeup: toggleMakeupFor,
            onVideoHomework: toggleVideoHomeworkFor,
            onVideoSubmitLink: toggleVideoSubmitLinkFor,
            onVideoHomeworkDue: setVideoHomeworkDueFor,
            // 새 보고서 필수 칸 — 카드와 같은 setter(원장 2026-10-26 *"카드와 표에서 동일하게"*). 열람 전용이면 안 넘긴다(칸이 안 선다).
            ...(readonlyView
              ? {}
              : {
                  onDailyTestSkip: setTestSkipFor,
                  onHomeworkMissReason: setHomeworkMissReasonFor,
                  onAttitudeNote: setAttitudeNoteFor,
                  onMakeupReason: setMakeupReasonFor,
                  onLessonMemo: setLessonMemoFor,
                }),
          }}
          rowActions={{
            onSendRow: sendRow,
            onAutoWrite: autoWriteRow,
            onOpenCard: openReportDetails,
            onImportPrev: importPrevFor,
            onAttach: (student, subjectName, files) => void addAttachmentsFor(student, subjectName, files),
            onRemoveAttachment: (student, subjectName, path) =>
              void removeAttachmentFor(student, subjectName, path),
            onOpenAttachments: (student, subjectName) => void ensureAttachmentUrls(student, subjectName),
            // 발송분은 버튼을 아예 열지 않는다(서버도 막지만 화면에서 먼저 알린다).
            onRemoveMakeup: (student, subjectName) => void removeMakeupRow(student, subjectName),
            // 보강 보고서 합치기 ↔ 나누기(원장 2026-10-22) — 판정 makeup-switch.ts.
            onJoinMakeup: (student, subjectName) => void joinMakeupRow(student, subjectName),
            onSplitMakeup: (student, subjectName) => void splitMakeupRow(student, subjectName),
            onPickMakeupClass: (student, subjectName) => void pickMakeupClass(student, subjectName),
            onCheckMakeup: (student, subjectName, outcome) => void checkMakeup(student, subjectName, outcome),
            canRemoveMakeup: (studentId, subjectName) =>
              canRemoveMakeupRow(reports[studentId]?.[subjectName]?.classnoteStatus ?? null),
            // 영어 행 경고 칩 — 카드 칸·발송 확인과 같은 판정(english-draft.ts).
            englishFlagsOf: englishRowFlags,
          }}
          bulkActions={{
            onSaveAll: saveAllVisible,
            onSendAll: sendAllVisible,
            onAutoWriteAll: autoWriteAllVisible,
            onClassNotice: classnoteOn ? openNoticeForRows : undefined,
            onBulkApply: bulkApplyValues,
            onCopyFirstRow: copyFirstRowDown,
            onBulkImportPrev: bulkImportPrev,
            // 안 불러온 보강 학생(표시 중인 반) — 있으면 표 위에 안내 + 일괄 불러오기 버튼(원장 2026-10-27).
            makeupPrev: (() => {
              if (readonlyView) return undefined;
              const ids = [
                ...new Set(
                  buildGridRows(visible)
                    .filter((r) => rowInClass(r.subject, activeClassFilter) && r.student.isMakeup && !prevLoaded.has(r.student.id))
                    .map((r) => r.student.id),
                ),
              ];
              return ids.length ? { count: ids.length, busy: makeupPrevBusy, onLoad: () => void loadMakeupPrevAll(ids) } : undefined;
            })(),
            onBulkAttach: (keys, files) => void bulkAttach(keys, files),
          }}
          uploadingAttKey={uploadingAttKey}
          order={orderClass && !readonlyView ? { classId: orderClass.id, onSave: saveOrderForClass } : undefined}
          classFilter={activeClassFilter}
          classOrder={classTags.filter(tag => tag !== CLASS_TAG_ALL)}
          // 반 서술(G6) — 순서 기능과 동일한 동명 반 가드(orderClass = 이름 매칭이 유일할 때만).
          // 키 = classId: 이름 키면 동명 두 반(수학·영어)에 서술이 교차 주입됨(리뷰 확정 major).
          narrative={{
            activeClass: orderClass ? orderClass.name : null,
            value: orderClass ? (classNarratives[orderClass.id] ?? "") : "",
            onSave: (text) => {
              // 열람 전용 — 이 저장은 **열람자 브라우저**에만 남아 "반영됩니다" 토스트가 거짓 약속이 되고,
              // 겸직이 나중에 본인 뷰에서 자동작성하면 열람 중 쓴 서술이 학부모 멘트로 샌다(교차 오염).
              if (readonlyBlocked()) return;
              if (!orderClass) return;
              setClassNarrative(activeDate, orderClass.id, text);
              toast.success(
                text.trim()
                  ? tf("os.c.narrativeSaved", { name: orderClass.name })
                  : tf("os.c.narrativeCleared", { name: orderClass.name }),
              );
            },
          }}
          attPending={attPending}
          attReadOnly={!canEditAttendance}
          genKey={genKey}
          // 일괄 작업(자동작성·저장·첨부) 중엔 일괄/행 버튼을 잠근다 — 핸들러는 이미 bulkBusy에서 되돌려보내고
          // 있었으므로(화면만 눌리는 척했다) 표시를 실제 동작에 맞춘 것.
          bulkGen={bulkGen || bulkBusy === "save"}
        />
  );
  const reportColumn = (
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
                        // 경고 셋은 저장값이 아니라 **지금 글·칸** 기준(english-draft.ts) — 새로고침·일괄 작성 뒤에도 맞다.
                        ...englishRowFlags(selected, previewSubject, previewReport),
                        jj: englishJjStatusOf(selected.id),
                        jjPick: englishJjPickOf(selected.id),
                        canLinkJj: canLinkIjw,
                        media: {
                          busy: uploadingAttKey === rowKey(selected.id, previewSubject.name),
                          full: (previewReport?.attachments?.length ?? 0) >= REPORT_ATTACHMENT_MAX,
                        },
                      }}
                      notice={templateNotice ?? (templateListFailed ? t("os.tpl.listFailed") : null)}
                      handlers={{
                        onTemplate: (id) => setEnglishTemplateFor(selected, previewSubject.name, id),
                        onNextTest: (v) => setNextTestFor(selected.id, previewSubject.name, v),
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
  // 미리보기는 부모 상태만 그린다. 호출마다 새 요소라 인라인 열과 대화상자가 같은 입력 카드를 나누지 않는다.
  const renderPreview = () => {
    if (!selected || !previewCtx || !previewSubject) return null;
    return (
      <ReportPreview
        ctx={previewCtx}
        student={selected}
        subject={previewSubject}
        draft={
          previewSubject.subjectKey === "english"
            ? englishPreviewDraft(selected, previewSubject, previewReport)
            : (previewReport?.draft ?? "")
        }
        trendDraft={previewReport?.trendDraft}
        trendHidden={isTrendHiddenFor(selected.id, previewSubject.name)}
        attachments={previewReport?.attachments ?? []}
        attachmentUrls={attUrls}
        trendRows={trendRows}
        templateMode={previewSubject.subjectKey === "english"}
        jjSheet={previewSubject.subjectKey === "english" && isJjSheetReport(previewReport)}
        jj={previewSubject.subjectKey === "english" ? englishJjSnapshotOf(selected.id) : null}
      />
    );
  };

  return (
    // 🔴 한 화면 고정(2026-08-06 원장): *"전체 창 크기를 가운데 보고서에 맞추고, 넘치는 부분은 스크롤 처리하도록
    //    각 섹션을 3개화"*. 셸 <main>이 이미 높이가 확정된 스크롤 컨테이너라 여기서 `h-full`로 그 높이를 받고,
    //    아래 3열이 남은 높이를 통째로 가져간 뒤 **열마다 따로** 스크롤한다(출석부 '한 화면 시트'와 같은 배치).
    //    ⚠️ `min-h-0`이 없으면 flex 아이템의 최소 크기가 콘텐츠라 열이 창을 넘겨 밀어낸다.
    <DisplayOptionsProvider value={displaySettings}>
    <ClassnoteOnProvider value={classnoteOn}>
    <div className={view === "notice" ? "flex min-h-0 flex-col gap-3" : "flex h-full min-h-0 flex-col gap-4 pb-3"}>
      {sendClassAsk ? <SendClassDialog ask={sendClassAsk} onClose={() => setSendClassAsk(null)} /> : null}
      <OneScreenTopBar
        readonlyView={readonlyView}
        classnoteOn={classnoteOn}
        today={today}
        date={activeDate}
        todayYmd={todayYmd}
        onDateChange={goToDate}
        classTags={classTags}
        classFilter={classFilter}
        onFilter={setClassFilter}
        writeFilter={writeFilter}
        writeCounts={writeCounts}
        onWriteFilter={changeWriteFilter}
        view={view}
        onView={changeView}
        todayClasses={todayClasses}
        noticeMode={noticeMode}
        academyNoticeMode={academyNoticeMode}
        onNoticeMode={changeNoticeMode}
        fontSize={fontSize}
        onFontSize={changeFontSize}
        makeupAdder={<MakeupAdder onAdd={addMakeupStudent} />}
      />

      {/* 발송 시간창 안내 — **지금이 창 밖일 때만**(KST, 분 단위 재판정 — 원장 지시 2026-07-29).
          창 안에선 발송이 그냥 나가므로 상시 안내는 노이즈. 실제 지연은 워커 게이트가 담당. */}
      {sendWindow ? <SendWindowNotice start={sendWindow.start} end={sendWindow.end} /> : null}

      {/* 학원설정 휴원일 — 시간표는 요일 반복이라 명단은 평소대로 선다. 막지 않고 사실만 알린다(원장 2026-10-13). */}
      {holidayName ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span className="font-bold">{tf("os.c.holidayTitle", { name: holidayName })}</span>
          <span>{t("os.c.holidayBody")}</span>
        </div>
      ) : null}

      {/* 그 요일에 담당 수업이 없을 때 — 예전엔 담당 반 전체가 '오늘 목록'처럼 떴다(2026-07-22 이수진 수요일:
          반 7개·학생 37명). 이제 목록 대신 사실을 말하고, 전체 보기는 **누를 때만** 연다. */}
      {noClassesToday && !showingAll ? (
        <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span className="text-foreground font-bold">{t("os.c.noClassTitle")}</span>
          <span>{t("os.c.noClassBody")}</span>
          <EmbedAnchor
            href={`/onescreen?date=${date}&all=1${view === "card" ? "" : `&view=${view}`}`}
            className="text-primary font-bold underline underline-offset-2"
          >
            {t("os.c.showAll")}
          </EmbedAnchor>
        </div>
      ) : null}
      {showingAll ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span className="font-bold">{t("os.c.showingAllTitle")}</span>
          <span>{t("os.c.showingAllBody")}</span>
          <EmbedAnchor
            href={`/onescreen?date=${date}${view === "card" ? "" : `&view=${view}`}`}
            className="font-bold underline underline-offset-2"
          >
            {t("os.c.showTodayOnly")}
          </EmbedAnchor>
        </div>
      ) : null}

      <SentReportNotice count={sentRowCount} />

      {/* 다른 창/기기 동시 열림 경고(3-3) — 소프트(락 아님). 빈 창이 잘 쓴 창을 덮지는 않는다(session-write.ts). */}
      {sameDateEditors.length > 0 ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-1.5 rounded-md border px-3 py-2 text-xs">
          <span className="font-bold">{t("os.c.presenceTitle")}</span>
          <span>{t("os.c.presenceBody")}</span>
        </div>
      ) : null}

      {/* 작성 필터 안내(월간 발송 뷰는 목록을 안 쓰므로 제외).
          ① 조건과 어긋난 채 남아 있는 학생 = 입력 중 사라지지 않게 고정한 결과라는 사실을 밝힌다(무언 잔류 금지).
          ② 필터 결과가 0명이면 왜 비었는지 말하고 되돌아갈 문을 준다(빈 화면 막다른 길 금지). */}
      {writeFilter !== "all" && view !== "history" ? (
        staleCount > 0 ? (
          <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
            <span>
              <b className="text-foreground">
                {tf("os.c.staleCount", {
                  label:
                    writeFilter === "unwritten" ? t("os.c.staleWritten") : t("os.c.staleEmptied"),
                  n: staleCount,
                })}
              </b>{" "}
              {t("os.c.staleBody")}
            </span>
            <button
              type="button"
              onClick={() => changeWriteFilter(writeFilter)}
              className="text-primary font-bold underline underline-offset-2"
            >
              {t("os.c.staleClear")}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
            <span className="text-foreground font-bold">
              {writeFilter === "unwritten"
                ? t("os.c.emptyUnwrittenAll")
                : t("os.c.emptyWrittenNone")}
            </span>
            <button
              type="button"
              onClick={() => changeWriteFilter("all")}
              className="text-primary font-bold underline underline-offset-2"
            >
              {t("os.c.showAllFilter")}
            </button>
          </div>
        ) : null
      ) : null}

      {/* 글씨 크기 — 목록·표 영역만 감싼다(상단 바는 그대로: 크기를 고르는 컨트롤 자체가 같이 커지면 어지럽다).
          ⚠️ `font-size`가 아니라 `zoom`인 이유는 font-size.ts 주석 참조(칸마다 px 글자가 박힌 조밀한 표).
          기본('작음')은 배율 1이라 **스타일 자체를 붙이지 않는다** — 손대지 않은 강사의 렌더는 완전 무변경. */}
      <div className={view === "card" ? "flex min-w-0 flex-col lg:min-h-0 lg:flex-1" : view === "notice" ? "min-w-0" : "pb-3"} style={fontZoom === 1 ? undefined : { zoom: fontZoom }}>
      {view === "grid" ? (
        reportGrid
      ) : view === "status" ? (
        <StatusBoard
          students={visible}
          reports={reports}
          onOpenCard={openCard}
          emptyLabel={emptyByWriteFilter}
        />
      ) : view === "history" ? (
        <SendCalendarBoard todayYmd={todayYmd} />
      ) : view === "notice" ? (
        <NoticeComposer
          key={`notice-${noticeSeed?.join(",") ?? ""}`}
          students={visible}
          seedStudentIds={noticeSeed}
          sendEnabled={classnoteSendEnabled}
          onSent={() => setNoticeSeed(null)}
        />
      ) : (
      /* 열 = 학생 · 보고서 · 학부모 미리보기(2026-08-05 통합, 2026-10-03 좁은 폭 개정).
         보고서 카드 안쪽의 1→2→3열은 그 카드의 @container다. 여기 열 개수는 이 배율 상자 안
         `@container/oscard` 폭이다(사이드바·창·글자 배율이 폭에 이미 들어 있다). 1420 이상이면
         3열이고 미리보기는 우측 544(실제 발송 이미지 폭). 그보다 좁으면 — 휴대폰 포함 — 미리보기를
         아래로 쌓거나 본문을 가로로 밀지 않고 버튼으로 연다. 2026-08-05 "항상 우측"은 3열이 들어갈 때만.
         ⚠️ 가로 스크롤 래퍼를 새로 만들지 않는다. 학생 목록 헤더 sticky의 기준이 그 래퍼로 바뀐다.
         보고서 카드는 이 그리드의 두 번째 칸에 그대로 둔다. 폭이 바뀌어도 다시 마운트하지 않는다. */
      <div className={ONESCREEN_CARD_FRAME}>
      {selected && previewCtx && previewSubject ? (
        <div className={ONESCREEN_PREVIEW_BUTTON}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-fit"
            onClick={() => setPreviewOpen(true)}
          >
            {t("os.preview.title")}
          </Button>
        </div>
      ) : null}
      <div className={ONESCREEN_CARD_GRID}>
        <StudentList
          students={visible}
          bulkPresent={bulkPresentProps}
          selId={effectiveId}
          selectedSubjectName={previewSubject?.name}
          onSelect={(id, subjectName) => {
            setSelId(id);
            const idx = students.find(s => s.id === id)?.subjects.findIndex(su => su.name === subjectName) ?? 0;
            setCardSubject({ id, idx: Math.max(0, idx) });
          }}
          statusForStudent={(student, lessonNow) => {
            const rows = student.subjects.filter(su => !isReportOptoutRow(su));
            const rowReports = Object.fromEntries(rows.map(su => [su.name, reports[student.id]?.[su.name]]).filter(([, rep]) => !!rep));
            // ClassNote 반 매칭 — 목록 행(반 그룹)의 수학 과목 줄 기준. 보강 행(classId 없음)은 라벨 없음.
            const cnRow = rows.find(su => !!su.classId && CN_SUBJECT_KEYS.has(su.subjectKey ?? ""));
            return {
              reportCell: reportCell(rowReports, rows.length),
              sendMark: buildSendMark({ subjects: rows, reports: reports[student.id], delivery: classnoteSendEnabled,
                label: sendMarkLabel, date: activeDate, now: lessonNow, lessons: todayClasses, showingAll }),
              cn: cnRow ? cnLabelFor(liveClassnoteMatch, { classId: cnRow.classId, subjectKey: cnRow.subjectKey, studentId: student.id, reportOptout: cnRow.reportOptout }) : null,
            };
          }}
          reportCellById={reportCellById}
          classFilter={activeClassFilter}
          classOrder={classTags.filter((tag) => tag !== CLASS_TAG_ALL)}
          testConfig={testCfg}
          emptyLabel={emptyByWriteFilter}
        />

        {reportColumn}
        {selected && previewCtx && previewSubject ? (
          <div className={ONESCREEN_PREVIEW_SLOT} data-onescreen-preview="inline">
            {/* 숨겨진 인라인 SVG와 대화상자의 gradient id가 겹치지 않게 한 면만 렌더한다. */}
            {previewOpen ? null : renderPreview()}
          </div>
        ) : null}
      </div>
      </div>
      )}
      </div>

      <Dialog open={view === "grid" && detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[1500px]" aria-describedby={undefined}>
          <DialogTitle>{t("os.card.details")}</DialogTitle>
          {view === "grid" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(530px,1fr)_544px]" style={fontZoom === 1 ? undefined : { zoom: fontZoom }}>
              {reportColumn}
              {selected && previewCtx && previewSubject ? (
                <div className={ONESCREEN_PREVIEW_SCROLL}>{renderPreview()}</div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={view === "card" && previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="w-[calc(100vw-2rem)]"
          // p-4 양쪽 32px + 데스크톱의 세로 스크롤바 여유 16px.
          style={{ maxWidth: Math.ceil(ONESCREEN_PREVIEW_WIDTH_PX * fontZoom) + 48 }}
          aria-describedby={undefined}
        >
          <DialogTitle>{t("os.preview.title")}</DialogTitle>
          <div className={ONESCREEN_PREVIEW_DIALOG_SCROLL} data-onescreen-preview="dialog">
            <div
              style={
                fontZoom === 1
                  ? { width: ONESCREEN_PREVIEW_WIDTH_PX }
                  : { width: ONESCREEN_PREVIEW_WIDTH_PX, zoom: fontZoom }
              }
            >
              {previewOpen ? renderPreview() : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={view === "card" && bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[1800px]" aria-describedby={undefined}>
          <DialogTitle>{t("os.card.bulk")}</DialogTitle>
          {reportGrid}
        </DialogContent>
      </Dialog>

      {/* '이전값 일괄 가져오기' 뒤 멘트 확인 — 나머지 칸은 이미 채워졌고, 여기 확인해야 학부모 문구까지 채운다.
          닫힘(취소)은 계획을 버리기만 한다(다른 칸 되돌리지 않음 — 그 칸들은 오늘 값 입력이라 문제 없음). */}
      <ConfirmDialog
        open={!!prevCommentPlan}
        title={t("os.c.prevCommentTitle")}
        message={tf("os.c.prevCommentBody", { n: prevCommentPlan?.length ?? 0 })}
        confirmLabel={t("os.c.prevCommentOk")}
        cancelLabel={t("os.c.prevCommentCancel")}
        onConfirm={applyPrevComments}
        onCancel={() => setPrevCommentPlan(null)}
      />

      {/* 보강 추가 — 합침(정규+보강 1건) ↔ 분리(보강 따로 1건) 확인. 취소하면 아무것도 안 생긴다.
          ⚠️ 조건부 렌더 + key: 다이얼로그 안 선택 상태를 열 때마다 초기화하기 위한 것이다(effect에서
             setState 금지 — React 19 룰). key가 없으면 직전 학생의 선택이 다음 학생에 새어든다. */}
      {makeupAsk ? (
        <MakeupConfirmDialog
          key={makeupAsk.studentId}
          studentName={makeupAsk.studentName}
          candidates={makeupAsk.candidates}
          sentSubjects={makeupAsk.sentSubjects}
          absences={makeupAsk.absences}
          absenceLoading={makeupAsk.absencesLoading}
          makeupDate={activeDate}
          hostClasses={hostChoicesOf(makeupAsk)}
          defaultHostClassId={defaultHostClassId(
            hostChoicesOf(makeupAsk)?.options ?? [],
            makeupAsk.mk.subjects.find((su) => su.makeupClassId)?.makeupClassId ?? null,
          )}
          pending={makeupSaving}
          onConfirm={resolveMakeupAsk}
          onCancel={() => { if (!makeupSaving) setMakeupAsk(null); }}
        />
      ) : null}
    </div>
    </ClassnoteOnProvider>
    </DisplayOptionsProvider>
  );
}
