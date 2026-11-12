"use client";

import { registerMakeupEntries } from "../server/makeup-register-actions";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { markWrite, withWriteOrigin } from "../write-timing-store";
import type { WriteField, WriteView } from "../write-timing";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { kstToday } from "@/lib/date-kst";
import { usePrintWindow } from "@/components/workspace/print-window";
import { ATTITUDE } from "../attitude";
import type { OneScreenView } from "../view";
// 저장·미리보기 공용 필드 조립(단일 소스) — 미리보기가 발송본과 갈라지지 않게.
import {
  loadReportTrend,
  setMyNoticeMode,
  setMyOnescreenFontSize,
  setMyLastReportTemplate,
  setMyTrendOptOut,
} from "../server/actions";
import { DisplayOptionsProvider, useDisplayOptionsState } from "./display-options-context";
import type { DisplayOptions } from "../display-options";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isJjSheetReport } from "../jj-books";
import {
  EMPTY_TEMPLATE_PREFS,
  rememberTemplate,
  retargetImplicit,
  settleImplicit,
  type TemplatePrefs,
} from "../last-template";
import { isTrendOptedOut, trendOptOutKey } from "../trend-optout";
import { removeMakeupEntry } from "../server/makeup-remove-actions";
import { checkMakeupReservation, moveReservationToRegular, setReservationReportMode } from "@/features/attendance/server/makeup-reservation-actions";
import { joinMakeupContent, joinText, planJoinMakeup, planSplitMakeup, type MakeupSwitchBlock } from "../makeup-switch";
import { canRemoveMakeupRow } from "../makeup-remove-plan";
import { makeupRowName } from "../makeup-label";
import { MakeupAdder } from "./makeup-adder";
import { SendWindowNotice } from "./send-window-notice";
import { EmbedAnchor } from "@/components/embed-link";
import type { CellState, OneScreenStudent, Subject } from "../types";
import dynamic from "next/dynamic";
import { OneScreenTopBar } from "./top-bar";
import { CLASS_TAG_ALL } from "../class-tags";
import { StudentList } from "./student-list";
import { buildSendMark } from "../send-mark";
import { SentReportNotice } from "./sent-report-notice";
import type { TodayClass } from "../server/roster";
import {
  EMPTY_UNDERSTANDING,
  isMathReportPilot,
  isPilotAutoWritten,
  pilotRecomposeNote,
  setAllUnderstanding,
  type UnderstandingState,
} from "../math-report-pilot";
import { type DailyTestSkip } from "../math-report-pilot-sections";
import { type SubjectReport } from "./report-card";
// 영어 템플릿 모드(2026-09-10) — 영어 행은 멘트 대신 템플릿 글(수학 경로 불변).
import {
  hasTextBesidesAttachments,
} from "@/features/report-templates/attachment-lines";
// 영어 행 인재원 하루치(2026-09-11) — 그림 칸(시험 결과지·학습 분석지) 재료. 카드로 연 행만 받는다.
import { useEnglishJj } from "./use-english-jj";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { ReportPreview, type ReportPreviewContext } from "./report-preview";
import {
  ONESCREEN_CARD_FRAME,
  ONESCREEN_CARD_GRID,
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
import {
  buildGridRows,
  effectiveClassnoteStatus,
  isAlreadySent,
  isReportOptoutRow,
  rowInClass,
} from "../grid";
import { gridEnglishFieldsOf } from "./grid-english-fields";
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
import { applyStudentOrder } from "../student-order";
import { saveStudentOrder } from "../server/order-actions";
import { useLiveClassnoteMatch } from "./use-live-classnote-match";
import { setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import { subscribeAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { applyAppliedAttendance } from "../apply-applied-attendance";
import { studentMarkFromRows } from "../attendance-mark";
import { STATUS_TEXT, statusTextOf } from "@/features/attendance/cell-display";
import type { AttendanceSelection } from "./attendance-pills";
import { useEditPresence, useEditingOthers } from "@/features/presence/edit-presence";
import { dedupeEditors } from "@/features/presence/presence-state";
import {
  MakeupConfirmDialog,
} from "@/features/attendance/components/makeup-confirm-dialog";
import { defaultHostClassId } from "@/features/attendance/makeup-host";
import { resolveRowFields, seedRowFields } from "../row-fields";
import { initReports, type ReportsState } from "../session-input";
import { useSessionAutosave } from "./use-session-autosave";
import { useRosterView } from "./use-roster-view";
import { useReportAttachments } from "./use-report-attachments";
import { useAutoWrite } from "./use-auto-write";
import { useBulkOps } from "./use-bulk-ops";
import { useBulkSend } from "./use-bulk-send";
import { useEnglishTemplateMode } from "./use-english-template-mode";
import { useMakeupFlow } from "./use-makeup-flow";
import { useMakeupPrev } from "./use-makeup-prev";
import { useSendCore } from "./use-send-core";
import { useReportSend } from "./use-report-send";
import { OneScreenCardColumn } from "./onescreen-card-column";
import { cnLabelFor, CN_SUBJECT_KEYS, type CnMatchMap } from "../classnote-match";
import { SendClassDialog } from "./send-class-dialog";
import { ClassnoteOnProvider } from "./classnote-on-context";
import { useSubmitLinkMode, useVideoHomeworkDueReady, useVideoHomeworkOthersReport, useVideoHomeworkPolicy, useVideoHomeworkSaveOk, useVideoHomeworkStore } from "@/features/video-homework/components/video-homework-provider";
import { setMyVideoDueDefault } from "../server/video-due-pref-actions";


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
 * 선생님 원스크린 메인 — 화면 state는 클라이언트에 있고, 편집은 세션(onescreen_daily_sessions)으로 자동저장된다
 * (use-session-autosave.ts). 보고서는 **과목(반) 행별로** 저장·발송한다(use-send-core.ts · use-report-send.ts).
 * 진도(today)는 과목별로 직접 입력.
 */
export function OneScreenClient({
  initial,
  today,
  date = "",
  classTags,
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
  today: string;
  date?: string; // 조회 대상 날짜(YYYY-MM-DD) — 저장/발송이 이 날짜로 report_date를 씀(빈값=서버가 오늘으로)
  classTags: readonly string[];
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
  // 공지 컴포저 진입 시 초기 선택 학생(카드=1명, 표=선택/표시). null=진입 안 함.
  const [noticeSeed, setNoticeSeed] = useState<string[] | null>(null);
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial, initialTemplatePrefs));
  // 영어 행의 인재원 하루치(2026-09-11) — 카드로 연 행·자동작성·다시 채우기에서만 받는다(use-english-jj.ts).
  const jj = useEnglishJj(activeDate);
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
  const [attPending, setAttPending] = useState<Set<string>>(new Set()); // 출결 저장 중 (학생::반) — pill 잠금(2-2)
  const [quickAttBusy, setQuickAttBusy] = useState(false); // 학생 목록 머리 '일괄 출석' 왕복 중 — 연타 방지
  const openPrint = usePrintWindow(); // "PDF" = 저장된 보고서를 인쇄 문서 플로팅 창으로 연다
  // 다른 창/기기 동시 열림 경고(3-3, 락 아님) — enabled=페이지 열림. 같은 계정 다른 탭/기기도 잡힌다(presence key 기준).
  useEditPresence(presenceScope, true);
  const sameDateEditors = dedupeEditors(useEditingOthers(presenceScope ?? ""));

  // 자동저장(디바운스 800ms) — 학생별 줄·ref 미러·날짜 이동 전 flush는 use-session-autosave.ts(P3-O).
  const { studentsRef, reportsRef, flushSavesRef, queueSave, applySessionSaveResult } = useSessionAutosave({
    students,
    reports,
    setStudents,
    date,
    showDailyTest,
    showCheckTest,
    t,
  });
  /**
   * '학습 추세 미발송'(원장 2026-09-18) — `반:학생` 키. 🔴 저장 조립은 비동기 경로(디바운스·발송)에서도 불리므로
   *    **ref로도** 들고 있는다 — 체크 직후 나간 저장이 옛 closure를 읽으면 끈 추세가 실린다.
   */
  const [trendOptOut, setTrendOptOut] = useState<ReadonlySet<string>>(() => new Set(initialTrendOptOut));
  const trendOptOutRef = useRef(trendOptOut);
  // 영어 템플릿 모드(목록·관리 창·반별 기본값·글 판정·만들기·다시 채우기 본문·복사) — use-english-template-mode.ts(P3-O).
  const {
    englishTemplates,
    setEnglishTemplates,
    templateNotice,
    templateManagerOpen,
    setTemplateManagerOpen,
    templatePrefsRef,
    templateListFailed,
    englishTemplatesRef,
    findTemplate,
    englishJjStatusOf,
    englishJjPickOf,
    englishJjSnapshotOf,
    englishPreviewDraft,
    englishRowFlags,
    englishTemplateNotReady,
    confirmEnglishOutput,
    outdatedEnglishRows,
    freshEnglishDraft,
    generateEnglishDraftFor,
    refillEnglishInner,
    copyEnglishText,
  } = useEnglishTemplateMode({
    students,
    initialTemplatePrefs,
    activeDate,
    report: { showDailyTest, showCheckTest, teacherName },
    classNarratives,
    jj,
    refs: { reportsRef, studentsRef },
    state: { setReports, patchReport },
    rowOutOfClass,
    t,
  });
  // 출결 in-flight 미러 — 상단 스트립 방송이 **내가 방금 누른 알약**을 되돌리지 않게(응답 역전 방지).
  const attPendingRef = useRef(attPending);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs). 타이머는 800ms 뒤라 항상 최신 반영.
  useEffect(() => {
    attPendingRef.current = attPending;
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

  // 명단 보기(반·작성 상태 필터 · 선택 학생 · 뷰)와 표시 목록 — use-roster-view.ts(P3-O).
  const {
    setSelId,
    classFilter,
    setClassFilter,
    writeFilter,
    view,
    setView,
    activeClassFilter,
    visible,
    writeCounts,
    emptyByWriteFilter,
    staleCount,
    changeWriteFilter,
    matchingClasses,
    orderClass,
    effectiveId,
    selected,
  } = useRosterView({
    initial,
    initialStudentId,
    initialClassName,
    initialView,
    readonlyView,
    classnoteOn,
    students,
    reports,
    todayClasses,
    t,
  });
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
  // 보강 추가 흐름(묻기·수업·결석분·합침/분리·수업 바꾸기·빼기) — use-makeup-flow.ts(P3-O).
  const {
    makeupSaving,
    setMakeupSaving,
    makeupAsk,
    setMakeupAsk,
    addMakeupStudent,
    hostChoicesOf,
    pickMakeupClass,
    removeMakeupRow,
    resolveMakeupAsk,
  } = useMakeupFlow({
    ctx: { date, activeDate, classFilter, matchingClasses, todayClasses },
    state: { students, setStudents, reports, setReports, studentsRef, templatePrefsRef },
    i18n: { t, tf },
    // askSendClass는 아래 저장·발송 코어(useSendCore)가 낸다 — 부를 때 그 렌더의 같은 함수를 찾는다.
    ui: { setSelId, setCardSubject, askSendClass: (ask) => askSendClass(ask) },
    rows: { patch, readonlyBlocked, applySessionSaveResult },
    // withMark는 아래(출결 함수들 곁)에 있다 — 부를 때 그 렌더의 같은 함수를 찾는다(순수 함수라 값이 같다).
    attendance: { setAttendanceFor, applyAttendanceLocal, withMark: (s) => withMark(s) },
  });
  // 보강 학생 이전 진도 불러오기(한 명·일괄) — use-makeup-prev.ts(P3-O).
  const { prevLoaded, makeupPrevBusy, loadMakeupPrev, loadMakeupPrevAll } = useMakeupPrev({ date, setStudents, i18n: { t, tf } });
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
        // 수업 나누기로 온 학생(0351a)은 서버가 나누기 표를 직접 보고 연다(`hasSplitInto` · 받는 반 = 출결 몫) — 플래그 없음(결정 #5 ②).
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
  /** 보강·수업외 행(담당 반 대신 같은 학원 학생) — 저장 입력과 인재원 조회가 같은 판정을 쓴다. */
  function rowOutOfClass(student: OneScreenStudent, su: Subject | undefined): boolean {
    return (student.isMakeup ?? false) || (!!su?.makeup && !su?.classId);
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
  /** EiE 일일 보고서(원장 2026-11-06) — 단어 테스트 피드백 · 재시험. 글은 '다시 채우기'·저장 직전 재조립이 맞춘다(다른 칸과 같다). */
  function setWordFeedbackFor(studentId: string, subjectName: string, text: string) {
    wt(studentId, subjectName, "nextTest");
    patchReport(studentId, subjectName, (r) => ({ ...r, wordFeedback: text.slice(0, 1000) }));
  }
  function setWordRetestFor(studentId: string, subjectName: string, on: boolean) {
    wt(studentId, subjectName, "dailyTest");
    patchReport(studentId, subjectName, (r) => ({ ...r, wordRetest: on }));
  }
  // AI 자동작성(카드·표·일괄 — 로딩 표시 셋은 따로) · 영어 다시 채우기 연타 막기 — use-auto-write.ts(P3-O).
  const { genSubject, genKey, bulkGen, refillEnglishFor, autoWriteSubject, autoWriteRow, autoWriteAllVisible } =
    useAutoWrite({
      ctx: { selected, readonlyView, date, activeDate, showDailyTest, showCheckTest, classNarratives },
      refs: { reportsRef, studentsRef },
      i18n: { t, tf },
      bulkBusy,
      // selectRows는 아래 useBulkOps가 낸다 — 이 훅이 먼저 불리므로 부를 때(이벤트) 그 렌더의 함수를 찾아 쓴다(값은 같다).
      rows: { selectRows: (action, keys) => selectRows(action, keys), latestRow, latestStudent },
      actions: { readonlyBlocked, patchReport },
      english: { generateEnglishDraftFor, refillEnglishInner },
    });
  // 표 일괄 작업(대상 행 고르기·값 일괄 적용·맨 위 행 복사·이전 회차 가져오기) — use-bulk-ops.ts(P3-O).
  const {
    prevCommentPlan,
    setPrevCommentPlan,
    liveClassnoteStatus,
    selectRows,
    bulkApplyValues,
    copyFirstRowDown,
    importPrevFor,
    bulkImportPrev,
    applyPrevComments,
  } = useBulkOps({
    view: { visible, activeClassFilter, classTags, displaySettings },
    ctx: { canEditAttendance, readonlyView, activeDate, lang },
    i18n: { t, tf },
    refs: { reportsRef, studentsRef },
    bulk: { bulkBusy, bulkGen },
    video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
    attendance: { setAttPending, applyAttendanceLocal },
    makeupPrev: { prevLoaded, loadMakeupPrevAll },
    setters: {
      setAttitudeValue,
      setAttitudeNoteFor,
      setHomeworkValue,
      setHomeworkMissReasonFor,
      setTextbookFor,
      setHomeworkTodayFor,
      setProgressFor,
      setProgressModeFor,
      setAllUnderstandingFor,
      toggleUnderstandingFor,
      setNoteFor,
      setMaxFor,
      setScoreFor,
      setTestSkipFor,
      rememberVideoDue,
      patch,
      patchReport,
    },
    readonlyBlocked,
  });
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
  // 보고서 저장·발송 코어(저장 입력 조립·저장·발송 대기·응답 반영·보낼 반 묻기) — use-send-core.ts(P3-O).
  const {
    sendClassAsk,
    setSendClassAsk,
    askSendClass,
    buildSaveInputFor,
    refreshJjBeforeOutput,
    applyKeptVideoHomework,
    applyVideoHomeworkDue,
    saveRecord,
    queueOne,
  } = useSendCore({
    ctx: { date, activeDate, readonlyView, showDailyTest, showCheckTest },
    refs: { reportsRef, studentsRef, trendOptOutRef },
    i18n: { t, tf },
    video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
    english: { jj, englishTemplatesRef, findTemplate, freshEnglishDraft, rowOutOfClass },
    rows: { patch, patchReport, latestStudent, writeView, boostClassnoteMatch },
  });
  /**
   * 기다린 뒤엔 **지금** 학생 값으로 저장한다 — 기다리는 동안 고친 칸이 빠지지 않게(적대 재리뷰 2026-09-11).
   * 그사이 그 과목 행이 사라졌으면 넘겨받은 학생 그대로(없는 행으로 과목·반이 빈 보고서를 만들지 않게).
   */
  function latestStudent(student: OneScreenStudent, subjectName: string): OneScreenStudent {
    const cur = studentsRef.current.find((s) => s.id === student.id);
    return cur && cur.subjects.some((su) => su.name === subjectName) ? cur : student;
  }
  // 카드·표 행의 저장/발송 버튼·공유 링크 + ClassNote 결과 감시 — use-report-send.ts(P3-O).
  const { sendSubject, queueClassnote, sendRow, revokeShare, reissueShare } = useReportSend({
    ctx: { date, activeDate, classnoteOn, lang },
    state: { selected, reports, setReports, studentsRef },
    i18n: { t, tf },
    bulk: { bulkBusy, bulkGen },
    core: { saveRecord, queueOne },
    rows: { patchReport, readonlyBlocked, confirmEnglishOutput },
    openPrint,
  });
  // 일괄 루프 중 학생·과목의 **최신** 스냅샷(ref) — 루프 중 편집을 반영하고 stale closure로 되돌리지 않게(#10).
  function latestRow(studentId: string, subjectName: string) {
    const student = studentsRef.current.find((s) => s.id === studentId);
    if (!student || !student.subjects.some((su) => su.name === subjectName)) return null;
    return student;
  }
  // 표 일괄 저장·발송 — use-bulk-send.ts(P3-O).
  const { saveAllVisible, sendAllVisible } = useBulkSend({
    view: { visible, activeClassFilter, classTags, displaySettings },
    ctx: { canEditAttendance, classnoteOn, showDailyTest, showCheckTest, sentRowCount },
    i18n: { t, tf },
    state: { reports, reportsRef },
    bulk: { bulkBusy, bulkGen, setBulkBusy },
    rows: { selectRows, liveClassnoteStatus, latestRow },
    english: { englishTemplateNotReady, outdatedEnglishRows },
    core: { saveRecord, queueOne },
    readonlyBlocked,
  });

  // 보고서 첨부(썸네일 서명·업로드·지우기·일괄) — use-report-attachments.ts(P3-O).
  const {
    attUrls,
    uploadingAttKey,
    addAttachmentsFor,
    addAttachments,
    insertEnglishMediaFor,
    removeAttachmentFor,
    removeAttachment,
    ensureAttachmentUrls,
    bulkAttach,
  } = useReportAttachments({
    selected,
    reports,
    reportsRef,
    studentsRef,
    date,
    readonlyView,
    classnoteOn,
    i18n: { t, tf },
    save: {
      readonlyBlocked,
      englishRowFlags,
      confirmEnglishOutput,
      refreshJjBeforeOutput,
      buildSaveInputFor,
      latestStudent,
      applyKeptVideoHomework,
      applyVideoHomeworkDue,
      patchReport,
    },
    bulk: { bulkBusy, bulkGen, setBulkBusy },
  });

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
            // 영어 행 템플릿 칸(다음 시간 테스트·단어 테스트·영상) — 카드와 같은 setter(원장 2026-11-12). 열람 전용이면 안 넘긴다.
            ...(readonlyView
              ? {}
              : { englishFieldsOf: gridEnglishFieldsOf({ findTemplate, uploadingAttKey, setNextTestFor, setWordFeedbackFor, setWordRetestFor, addAttachmentsFor }) }),
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
  // 카드 뷰 가운데 열(보고서 작성) — onescreen-card-column.tsx(P3-O).
  const reportColumn = (
    <OneScreenCardColumn
      selected={selected}
      ctx={{
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
      }}
      row={{ previewSubject, previewReport, subjectIdx, reports, setReports }}
      card={{
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
      }}
      rowActions={{
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
      }}
      english={{
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
      }}
    />
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
