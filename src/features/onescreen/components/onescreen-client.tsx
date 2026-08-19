"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { kstToday } from "@/lib/date-kst";
import { usePrintWindow } from "@/components/workspace/print-window";
import { CLASS_TAGS, TODAY } from "../data";
import { ATTITUDE } from "../attitude";
import type { OneScreenView } from "../view";
import { buildSubjectReport, studentStatus } from "../report";
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
} from "../server/actions";
import { removeMakeupEntry } from "../server/makeup-remove-actions";
import { canRemoveMakeupRow, makeupRemoveBlockReason } from "../makeup-remove-plan";
import { MakeupAdder } from "./makeup-adder";
import { SendWindowNotice } from "./send-window-notice";
import {
  issueReportAttachmentUploadTicket,
  registerReportAttachment,
  removeReportAttachment,
  signReportAttachmentUrls,
} from "../server/attachment-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import type { AttendanceMark, CellState, OneScreenStudent, Subject } from "../types";
import { OneScreenTopBar } from "./top-bar";
import { StudentList, type SendMark } from "./student-list";
import type { TodayClass } from "../server/roster";
import { ProgressCard } from "./progress-card";
import { SheetSourceCard } from "./sheet-source-card";
import { TestCard } from "./test-card";
import { ReportCard, type SubjectReport } from "./report-card";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { ReportPreview, type ReportPreviewContext } from "./report-preview";
import type { TrendReportRow } from "../report-trend";
import type { ReportSettings } from "@/features/owner/settings-types";
import { OneScreenGrid } from "./onescreen-grid";
import { StatusBoard } from "./status-board";
import { SendCalendarBoard } from "./send-calendar";
import { NoticeComposer } from "./notice-composer";
import {
  buildGridRows,
  rowKey,
  effectiveClassnoteStatus,
  isAlreadySent,
  isAttendanceUnchecked,
  isClassMember,
  isCopyTargetRow,
  isRowInputEditable,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  isReportEligible,
  planBulkPrevFill,
  planPrevComments,
  planCopyFirstRow,
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
import { mergeClassnoteStatuses, pendingSendStudentIds, type ClassnoteStatusRow } from "../classnote-status";
import { linkMakeupToAbsence, setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import { STATUS_TEXT } from "@/features/attendance/cell-display";
import type { BasicAttendance } from "./attendance-pills";
import { useEditPresence, useEditingOthers } from "@/features/presence/edit-presence";
import { dedupeEditors } from "@/features/presence/presence-state";
import {
  MakeupConfirmDialog,
  type MakeupConfirmChoice,
} from "@/features/attendance/components/makeup-confirm-dialog";
import { fetchMakeupAbsences } from "@/features/attendance/server/makeup-actions";
import { noteMakeupAgainstAbsence } from "@/features/attendance/server/makeup-note-action";
import type { MakeupAbsenceOption } from "@/features/attendance/makeup-options";
import { mergeStatusOf, planMakeupMerge, type MergeCandidate } from "../makeup-merge-plan";
import { hasRowOverrides, resolveRowFields, seedRowFields } from "../row-fields";
import { detectClassNotices } from "../class-notice";
import { shortDate } from "../makeup-absence-link";
import { computeClientMentSource } from "../ment-source";

type ReportsState = Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → {draft, sent}

function initReports(students: OneScreenStudent[]): ReportsState {
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
        sent: su.reportSent ?? false,
        shareToken: su.shareToken,
        classnoteStatus: su.classnoteStatus,
        revoked: !!su.revokedAt,
        viewCount: su.viewCount,
        attachments: su.attachments ?? [],
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
  sendWindow = null,
  showAttachments = true,
  canEditAttendance = true,
  readonlyView = false,
  presenceScope,
  initialView = "card",
  initialFontSize = DEFAULT_ONESCREEN_FONT_SIZE,
  initialClassName = null,
  initialStudentId = null,
  noClassesToday = false,
  showingAll = false,
  teacherName = "",
  reportSettings,
  academyName = "",
  logoSrc = null,
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
  /** 그 요일에 담당 수업이 없음 — 목록 대신 안내를 띄운다(폴백 금지, roster.ts 주석). */
  noClassesToday?: boolean;
  /** '담당 반 전체 보기'로 보는 중(요일 무시) — 화면이 그 사실을 밝힌다. */
  showingAll?: boolean;
  sendWindow?: { start: string; end: string } | null; // 발송 허용 시간창 원문(무제한=null) — 창 밖일 때만 안내 배너
  showAttachments?: boolean; // 사진/파일 첨부 표시(학원 설정) — off면 첨부해도 안 실린다는 경고를 카드에 표시
  canEditAttendance?: boolean; // 출결 쓰기 권한 — false면 pill을 표시 전용으로(서버 거절 전에 화면에서 알림)
  /** '다른 강사 뷰'(열람 전용, 2026-08-19) — 전 입력·발송·저장 UI 잠금 + 핸들러 차단(서버 가드의 거울). */
  readonlyView?: boolean;
  presenceScope?: string; // `onescreen:{teacherId}:{date}` — 다른 창/기기 동시 열림 경고(서버가 teacherId 파생)
  initialView?: OneScreenView; // URL(?view=)에서 온 초기 뷰 — 날짜 이동(재마운트) 후에도 보던 뷰 유지
  /** 글씨 크기(내 계정, users.ui_prefs.onescreen.fontSize) — 서버 확정값이라 첫 렌더부터 정확(#75 회피). */
  initialFontSize?: OnescreenFontSize;
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
  reportSettings?: ReportSettings;
  academyName?: string;
  logoSrc?: string | null;
}) {
  const router = useRouter();
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [noticeMode, setNoticeMode] = useState<"A" | "B" | null>(initialNoticeMode);
  // 글씨 크기 — 화면은 즉시(클릭 반응), 계정 저장은 백그라운드(실패해도 이번 세션 크기는 유지).
  const [fontSize, setFontSize] = useState<OnescreenFontSize>(initialFontSize);
  const fontZoom = ONESCREEN_FONT_SIZE_ZOOM[fontSize];
  // 보강 학생 중 '이전 진도'를 이미 불러온 학생 id — 버튼 숨김·재요청 방지.
  const [prevLoaded, setPrevLoaded] = useState<Set<string>>(new Set());
  // 진입 시 반·학생 지정(2026-08-07) — '오늘 ECS' 카드에서 넘어올 때 그 반(·그 학생)에서 시작한다.
  // ⚠️ 값 검증은 **서버**가 한다(그 날짜 로스터에 실제로 있는 반/학생만 내려온다) — 여기선 그대로 쓴다.
  const [selId, setSelId] = useState<string>(initialStudentId ?? initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>(initialClassName ?? "전체");
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
            reportDate: activeDate,
            showDailyTest,
            showCheckTest,
          }
        : undefined,
    [reportSettings, academyName, logoSrc, teacherName, activeDate, showDailyTest, showCheckTest],
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
    readonlyView && initialView === "notice" ? "card" : initialView,
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
  const [makeupAsk, setMakeupAsk] = useState<{
    studentId: string;
    studentName: string;
    mk: OneScreenStudent;
    candidates: MergeCandidate[];
    sentSubjects: string[];
    /** 목록에 없던 학생(그날 내 정규 수업 없음) — 확인 후에 카드를 만든다. */
    isNew: boolean;
    /** 그 학생의 결석 기록(이전 반 포함) — 이월 보강 선택지. */
    absences: MakeupAbsenceOption[];
    /** 아직 불러오는 중 — 도착 전에 "결석 기록이 없습니다"라고 단언하지 않게. */
    absencesLoading: boolean;
  } | null>(null);
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial));
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(카드 버튼 로딩)
  const [genKey, setGenKey] = useState<string | null>(null); // 표 행별 자동작성 로딩 키(studentId::과목)
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
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs). 타이머는 800ms 뒤라 항상 최신 반영.
  useEffect(() => {
    studentsRef.current = students;
    reportsRef.current = reports;
  });
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);
  // 대기 중 자동저장을 즉시 커밋(날짜 이동 전 호출) — 디바운스 800ms 안에 이동하면 유실되던 편집 방어.
  useEffect(() => {
    flushSavesRef.current = () => {
      for (const [sid, t] of saveTimers.current) {
        clearTimeout(t);
        const s = studentsRef.current.find((x) => x.id === sid);
        if (!s || s.isMakeup) continue;
        void saveOnescreenSession(buildSessionInput(s, reportsRef.current[sid])).then((res) => {
          if (!res.ok) toast.error(res.error ?? "자동 저장에 실패했습니다");
        });
      }
      saveTimers.current.clear();
    };
  });
  function buildSessionInput(s: OneScreenStudent, r: Record<string, SubjectReport> | undefined) {
    return {
      studentId: s.id,
      sessionDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — 과거 날짜 작업분도 그 날짜 세션에 저장
      classId: s.classId ?? null,
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
              textbook: su.textbook ?? "",
              makeup: su.makeup ?? false,
              homeworkToday: su.homeworkToday ?? "",
              // 행 단위 평가값(태도·점수·과제 수행률·특이사항) — 지정된 행만 싣는다(row-fields.ts).
              // 미지정 행은 옛 세션과 같은 모양으로 남아 로스터가 학생 값으로 폴백한다(하위호환).
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
        if (!s || s.isMakeup) return; // 보강 학생은 반이 없어 세션(onescreen_daily_sessions) 저장 스킵
        void saveOnescreenSession(buildSessionInput(s, reportsRef.current[studentId])).then((res) => {
          if (!res.ok) toast.error(res.error ?? "자동 저장에 실패했습니다");
        });
      }, 800),
    );
  }

  // 반 필터 — 특정 반이면 그 반 수강생 전부(tags로 다과목/다반 학생도 양쪽에서 잡음, 누락 방지) + 좌측 그룹 라벨을
  // 필터 반으로 리맵. 표 행은 activeClassFilter로 rowInClass 필터해 타 반 과목 행 혼입을 막는다.
  const activeClassFilter = classFilter === "전체" ? null : classFilter;
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
        ? "미작성 학생이 없습니다"
        : "작성한 학생이 없습니다";
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
    classFilter !== "전체" ? todayClasses.filter((c) => c.name === classFilter) : [];
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
  for (const s of students) reportCellById[s.id] = reportCell(reports[s.id], s.subjects.length);
  // 이름 옆 발송 표시(원장 2026-07-27: "발송완료면 체크 같은 걸 이름 옆에" — 지금은 라벨 불 들어온 걸로만 구분).
  // 기준은 **학부모에게 실제로 나간 행**(ClassNote 발송 완료) — '저장됨'과 다르다(저장만으론 안 나간다).
  // ⚠️ ClassNote 발송이 꺼진 학원은 게시가 아예 없어 표시가 영원히 안 뜬다 → 그땐 '보고서 저장' 기준으로
  //    폴백하되, 툴팁 라벨로 어느 기준인지 밝힌다(같은 아이콘이 말없이 다른 뜻이 되지 않게).
  // ⚠️ 분모에서 결석 행은 뺀다 — 발송이 원천 차단된 행이라 남기면 "1/2"가 영영 안 채워진다(#77과 같은 이유).
  const sendMarkLabel = classnoteSendEnabled ? "학부모 발송" : "보고서 저장";
  const sendMarkById: Record<string, SendMark> = {};
  for (const s of students) {
    const rows = s.subjects.filter((su) => su.attendanceRaw !== "absent");
    const sent = rows.filter((su) => {
      const rep = reports[s.id]?.[su.name];
      return classnoteSendEnabled
        ? isAlreadySent(effectiveClassnoteStatus(rep?.classnoteStatus, su.classnoteStatus))
        : rep?.sent === true;
    }).length;
    sendMarkById[s.id] = { sent, total: rows.length, label: sendMarkLabel };
  }
  const doneCount = students.filter((s) => {
    const st = studentStatus(s, testCfg);
    return st.prog === "ok" && st.test === "ok" && reportCellById[s.id] === "ok";
  }).length;

  // 허브 통계(B2) — 오늘 마감 진행 현황.
  // 이 날짜에 **이미 학부모에게 나간** 행 수 — 상단 안내 + "왜 수정/발송이 막혔나"의 근거.
  // ⚠️ 화면 state(reports)를 본다: 로스터 스냅샷만 보면 세션 중 방금 보낸 건이 안 세어진다.
  const sentRowCount = visible.reduce(
    (n, s) =>
      n +
      s.subjects.filter((su) => isAlreadySent(effectiveClassnoteStatus(reports[s.id]?.[su.name]?.classnoteStatus, su.classnoteStatus)))
        .length,
    0,
  );

  const hubStats = {
    students: students.length,
    progressDone: students.filter((s) => s.progressConfirmed).length,
    testDone: students.filter((s) => studentStatus(s, testCfg).test === "ok").length,
    reportDone: students.filter((s) => reportCellById[s.id] === "ok").length,
  };

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
  useClassnoteStatusSync(date, pendingSends, applyClassnoteStatuses);

  function patchReport(
    studentId: string,
    subjectName: string,
    fn: (r: SubjectReport) => SubjectReport,
  ) {
    setReports((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [subjectName]: fn(prev[studentId]?.[subjectName] ?? { draft: "", sent: false }),
      },
    }));
    queueSave(studentId);
  }

  function confirmProgress() {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, progressConfirmed: !s.progressConfirmed }));
  }
  // ── studentId 파라미터 핸들러(표=행별 직접 호출, 카드=selected wrapper) — 로직 단일 소스 ──
  function setProgressFor(studentId: string, subjectIndex: number, today: string) {
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((su, i) => (i === subjectIndex ? { ...su, today } : su)),
    }));
  }
  /** 오늘 수업 성격(복습·문제풀이) 토글 — 진도와 **함께** 사는 축이라 진도 값은 건드리지 않는다. */
  function setProgressModeFor(studentId: string, subjectIndex: number, mode: string | null) {
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
      toast.error(res.error ?? "멘트 모드 저장에 실패했습니다");
    } else {
      toast.success(
        mode === null ? "멘트 모드: 학원 기본" : `멘트 모드: ${mode === "A" ? "단일 문단" : "2문단 분리"}`,
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
    if (!res.ok) toast.error("글씨 크기를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다");
  }
  /** 보강을 그 수업 출석부에 남긴다 — ECS·출석부 명단이 같은 학생을 보게. 이미 그 반 수강이면 건너뛴다. */
  function persistAnchorMakeup(
    studentId: string,
    classId: string | null,
    enrolledInAnchor: boolean,
    units?: number,
  ) {
    if (!classId || enrolledInAnchor) return;
    void setAttendanceCell({
      studentId,
      classId,
      sessionDate: activeDate,
      status: "makeup",
      allowMakeup: true,
      // 확인창에서 고른 시수를 그 칸에 그대로 적는다(1이면 서버가 접는다) — 급여가 이 값을 읽는다.
      ...(units && units !== 1 ? { units: String(units) } : {}),
    }).then((r) => {
      if ("error" in r) toast.error(`출석부 보강 기록을 남기지 못했습니다 — ${r.error}`);
    });
  }
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
      toast.error(res.error ?? "학생을 추가하지 못했습니다");
      return;
    }
    // 보강을 **어느 수업 시간에** 하는지 = 지금 보고 있는 반 필터. 이게 반 필터 앵커가 된다(0171a) —
    // 앵커가 없으면(전체에서 추가·동명 반이라 특정 불가) 그 보강 행은 '전체'에서만 보인다.
    // 🔴 예전엔 앵커가 없어 보강 학생이 **모든 반 필터**에 나왔다(원장 제보 2026-08-03).
    // ⚠️ 이름은 **필터가 걸려 있으면 항상** 남긴다(id는 동명 반이면 특정 불가 → null). id가 없다고 이름까지
    //    비우면, 동명 반을 고른 채 보강을 추가했을 때 카드가 그 자리에서 사라진다 = 2026-07-27 그 버그 재발.
    const anchorName = classFilter === "전체" ? null : classFilter;
    const anchorId = matchingClasses.length === 1 ? matchingClasses[0]!.id : null;
    const withAnchor = (su: Subject): Subject => ({
      ...su,
      makeupClassId: anchorId,
      makeupClassName: anchorName,
    });
    const mk = { ...res.student, subjects: res.student.subjects.map(withAnchor) };
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
        absences: [],
        absencesLoading: true,
      });
      void loadAbsences(studentId);
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
        `${existing.name} — ${plan.subjects.join("·")}는 이미 보강이 합쳐져 있습니다(정규+보강). 한 타임 더 했다면 수업타임을 올려 주세요.`,
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
        candidates: plan.candidates,
        sentSubjects,
        isNew: false,
        absences: [],
        absencesLoading: true,
      });
      void loadAbsences(studentId);
      return;
    }
    // 합칠 정규 행이 없다(그날 결석·다른 강사 과목 등) → **그래도 묻는다**. 결석 보강이 바로 이 경로라
    // 예전엔 가장 흔한 보강에서 결석분·시수를 물을 자리가 없었다(원장 2026-08-19).
    setMakeupAsk({
      studentId,
      studentName: existing.name,
      mk,
      candidates: [],
      sentSubjects: [],
      isNew: false,
      absences: [],
      absencesLoading: true,
    });
    void loadAbsences(studentId);
  }
  /** 결석 후보(이전 반 포함)를 뒤늦게 채운다 — 창은 먼저 열고 목록만 도착하면 갈아 끼운다. */
  async function loadAbsences(studentId: string) {
    const list = await fetchMakeupAbsences(studentId, activeDate).catch(() => []);
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
    // 경고는 **무엇이 사라지는지 그대로** 적는다(원장 *"경고하고 확인하면 삭제"*).
    const lines = [
      `${student.name} 보강을 뺄까요?`,
      "",
      "출결 기록·저장된 보강 수업보고서·그 수업으로 올라간 진도 기록이 모두 삭제됩니다.",
      "보강을 추가하기 전 상태로 돌아가며, 되돌릴 수 없습니다.",
    ];
    if (!window.confirm(lines.join("\n"))) return;
    const res = await removeMakeupEntry({
      studentId: student.id,
      date: activeDate,
      classId: su.makeupClassId ?? null,
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
            ? { ...s, subjects: s.subjects.filter((x) => x.name !== subjectName) }
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
  function resolveMakeupAsk(choice: MakeupConfirmChoice) {
    const ask = makeupAsk;
    setMakeupAsk(null);
    if (!ask) return;
    const anchorIdNew = ask.mk.subjects.find((su) => su.makeupClassId)?.makeupClassId ?? null;
    if (ask.isNew) {
      // 목록에 없던 학생 — 확인을 받았으니 이제 카드를 만든다(취소했으면 여기 안 온다).
      const mk = ask.mk;
      setStudents((prev) => (prev.some((s) => s.id === mk.id) ? prev : [...prev, mk]));
      setReports((prev) => ({ ...prev, [mk.id]: initReports([mk])[mk.id] ?? {} }));
      setSelId(mk.id);
      persistAnchorMakeup(mk.id, anchorIdNew, false, choice.addUnits);
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(mk.id, anchorIdNew, choice, mk.name);
      } else {
        // ⚠️ 앵커(보고 있는 반)가 없으면 출결에 남길 칸이 없다 — 시수를 약속하지 않는다(지킬 수 없다).
        toast.success(
          anchorIdNew
            ? `${mk.name} (보강) 추가됨 — 수업타임 ${choice.addUnits}`
            : `${mk.name} (보강) 추가됨 — 반 필터가 '전체'라 출결에는 남기지 않았습니다(반을 고르면 함께 기록됩니다).`,
        );
      }
      return;
    }
    const existing = studentsRef.current.find((s) => s.id === ask.studentId);
    if (!existing) {
      toast.error("학생 카드를 찾지 못했습니다 — 새로고침 후 다시 시도해 주세요");
      return;
    }
    if (!choice.candidate) {
      // 합칠 정규 행이 없는 보강(그날 결석·다른 강사 과목) — 보강 행만 만들고 시수·결석분은 앵커 반에 적는다.
      addSeparateMakeupRows(existing, ask.mk);
      persistAnchorMakeup(
        existing.id,
        anchorIdNew,
        existing.subjects.some((su) => su.classId === anchorIdNew && !su.makeup),
        choice.addUnits,
      );
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(existing.id, anchorIdNew, choice, existing.name);
      } else {
        toast.success(
          anchorIdNew
            ? `${existing.name} (보강) 추가됨 — 수업타임 ${choice.addUnits}`
            : `${existing.name} (보강) 추가됨 — 반 필터가 '전체'라 출결에는 남기지 않았습니다(반을 고르면 함께 기록됩니다).`,
        );
      }
      return;
    }
    const anchorId = anchorIdNew;
    const enrolledInAnchor = existing.subjects.some((su) => su.classId === anchorId && !su.makeup);
    persistAnchorMakeup(existing.id, anchorId, enrolledInAnchor);
    if (choice.mode === "separate") {
      // 🔴 **고른 과목의 보강 행만** 만든다. 안 좁히면 그 강사가 가르치는 학생의 다른 과목까지 "(보강)" 행이
      //    딸려 붙어(예: 영어가 오늘 결석이라 후보엔 없어도 행은 생겼다) 보고서가 2건이 아니라 3건 나간다 —
      //    다이얼로그가 "모두 2건" 이라고 약속한 것과 어긋난다. 강사가 어느 수업인지 이미 골랐으니 추측할 게 없다.
      if (addSeparateMakeupRows(existing, ask.mk, true, choice.candidate!.subjectKey)) {
        // 🔴 결석일은 **선택**이다(원장 2026-08-07 *"오늘 날짜에 추가 보강할 수도 있잖아"*). 없으면
        //    결석분 연결 없이 시수만 얹는다. 예전엔 이 분기가 없어 날짜가 비면 **조용히 '합침'으로**
        //    떨어졌다 — 강사는 '분리'를 골랐는데 보고서가 1건만 나가는, 화면과 다른 결과였다.
        if (choice.absentDate)
          void linkMakeupAbsence(existing, choice.candidate!, choice.absentDate, choice.addUnits, choice.absentClassId);
        else void addMakeupUnitsOnly(existing, choice.candidate!, choice.addUnits);
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
  ) {
    // 🔴 시수는 `persistAnchorMakeup`이 그 칸에 이미 적었다 — 여기선 **메모만**(합산 액션을 쓰면 두 번 더해진다).
    const res = await noteMakeupAgainstAbsence({
      studentId,
      makeupClassId,
      makeupDate: activeDate,
      absentClassId: choice.absentClassId ?? makeupClassId,
      absentDate: choice.absentDate!,
    });
    if ("error" in res) {
      toast.error(`보강은 추가됐지만 결석분 연결에 실패했습니다 — ${res.error}`);
      return;
    }
    toast.success(
      res.absenceNoted
        ? `${name} 보강 추가 — ${shortDate(choice.absentDate!)} 결석 칸에 메모, 수업타임 ${choice.addUnits}`
        : `${name} 보강 추가 — 수업타임 ${choice.addUnits}. ${shortDate(choice.absentDate!)} 칸엔 결석 기록이 없어 메모는 남기지 않았습니다.`,
    );
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
  ) {
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
      toast.error(`보강 시수를 기록하지 못했습니다 — ${res.error}`);
      return;
    }
    // 화면의 그 행 시수도 서버 결과로 맞춘다(1이면 서버가 null로 접으므로 같은 규칙으로).
    // ⚠️ 기록이 없던 날엔 서버가 '출석'으로 열었다 — 화면 raw도 같이 present로 맞춰야 표시가 안 갈린다.
    applyAttendanceLocal(existing.id, target.classId, target.attendanceRaw ?? "present", {
      units: res.units === 1 ? null : res.units,
    });
    if (res.alreadyLinked) {
      toast.message(`${shortDate(absentDate)} 결석분 보강은 이미 기록돼 있습니다 — 수업타임을 다시 올리지 않았습니다.`);
      return;
    }
    // ⚠️ 결석 기록이 없던 날이면 메모를 안 남긴다 — 조용히 넘기지 말고 그 사실을 밝힌다.
    toast.success(
      res.absenceNoted
        ? `${existing.name} 보강 추가 — ${shortDate(absentDate)} 칸에 메모, ${target.name} 수업타임 ${res.units}`
        : // 선보강(아직 안 지난 날)이면 "기록이 없다"가 아니라 **아직 오지 않았다**가 사실이다 —
          //    같은 문장으로 뭉뚱그리면 강사가 "왜 기록이 없지?" 하고 출석부를 뒤진다.
          absentDate > activeDate
          ? `${existing.name} 보강 추가 — ${target.name} 수업타임 ${res.units}. ${shortDate(absentDate)}은 아직 오지 않은 날이라 그 칸엔 메모를 남기지 않았습니다(그날 출결을 입력할 때 적어 주세요).`
          : `${existing.name} 보강 추가 — ${target.name} 수업타임 ${res.units}. 단 ${shortDate(absentDate)}엔 출결 기록이 없어 메모는 남기지 않았습니다.`,
      { duration: 8000 },
    );
  }
  /** 합침 — 정규 행에 보강 표시를 켜고(제목 "(정규+보강)", makeup-label.ts) 출석부 수업타임을 얹는다. */
  /**
   * 추가 보강(결석분 연결 없음) — 보강 행은 이미 따로 만들었고, 여기서는 **그 날 칸의 시수만** 올린다.
   * ⚠️ 정규 행에 `makeup: true`를 켜지 않는다 — 그건 '합침'(제목 "(정규+보강)", 보고서 1건)의 표시다.
   *    분리는 보고서가 2건이므로 정규 행은 정규 그대로 둔다.
   */
  function addMakeupUnitsOnly(existing: OneScreenStudent, target: MergeCandidate, addUnits: number) {
    const units = (target.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      target.classId,
      mergeStatusOf(target.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 보강 시수 합산은 성공 안내를 이미 띄웠다 — conflict no-op이면 안내가 거짓이 된다
    );
    setSelId(existing.id);
    toast.success(
      `${existing.name} 보강 추가 — ${target.name} 보고서 2건(정규·보강 따로) · 수업타임 ${units}. 결석분 연결은 없습니다(추가 보강).`,
      { duration: 8000 },
    );
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
        `${existing.name} — ${merge.name} 보고서가 이미 발송되어 보강 내용은 보고서에 실리지 않습니다. 출석부 수업타임만 올렸습니다(수업타임 ${units}).`,
        { duration: 10000 },
      );
    } else {
      toast.success(`${existing.name} 보강 합침 — ${merge.name} 보고서 1건(정규+보강) · 수업타임 ${units}`);
    }
  }
  /**
   * 분리 — 종전(2026-08-05 이전)대로 별도 "(보강)" 행. 정규와 별개 보고서라 발송도 따로 나간다.
   * @returns 행이 실제로 늘었는가 — 호출부가 이 값으로 결석분 연결(시수 +1)을 걸지 판단한다.
   */
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
    const makeupRows = source
      // 같은 과목 보강 행이 이미 있으면 중복 추가 안 함.
      .filter((su) => !existing.subjects.some((ex) => ex.makeup && !ex.classId && ex.subjectKey === su.subjectKey))
      .map((su) => {
        let name = `${su.name} (보강)`;
        let n = 2;
        while (used.has(name)) name = `${su.name} (보강 ${n++})`;
        used.add(name);
        // ⚠️ classId=null·makeup=true 유지(반 무관 보강). subjectLabel은 깨끗한 라벨 — 진도 접두에 "(보강)" 누출 방지.
        // 반 필터 앵커(makeupClassId/Name)는 `mk`에 이미 실려 있다 — **'추가'를 누른 시점**의 반 필터라,
        // 다이얼로그를 띄워 두는 동안 강사가 필터를 바꿔도 보강이 엉뚱한 수업에 붙지 않는다.
        return { ...su, name, classId: null, makeup: true, subjectLabel: su.subjectLabel ?? su.name };
      });
    if (makeupRows.length === 0) {
      setSelId(existing.id);
      toast.message("이미 보강 행이 추가되어 있습니다");
      return false;
    }
    patch(studentId, (s) => ({ ...s, subjects: [...s.subjects, ...makeupRows] }));
    const slots = initReports([{ ...existing, subjects: makeupRows }])[existing.id] ?? {};
    setReports((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? {}), ...slots } }));
    setSelId(studentId);
    // 결석분 연결이 뒤따르는 경로(다이얼로그 '분리')는 그쪽 토스트가 시수까지 밝히므로 여기선 조용히(silent).
    if (!silent) toast.success(`${existing.name} 보강 추가됨`);
    return true;
  }
  // 보강 학생 '이전 진도 불러오기' — 직전 회차를 당겨 prev/prevReport/prevScore를 채운다(세션 저장 없음).
  async function loadMakeupPrev(studentId: string) {
    const res = await loadMakeupHistory(studentId, date || undefined); // 조회 중인 날짜 기준 직전 회차(과거 백필 정합)
    if (!res.ok || !res.bySubject) {
      toast.error(res.error ?? "이전 진도를 불러오지 못했습니다");
      return;
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
    toast.success(
      Object.keys(bySubject).length ? "이전 진도를 불러왔습니다" : "이전 보고서가 없습니다",
    );
  }
  function setScoreFor(studentId: string, subjectName: string, which: "daily" | "check", v: number | null) {
    patchRowEval(studentId, subjectName, (su) => ({ ...su, [which === "daily" ? "dailyScore" : "checkScore"]: v }));
  }
  // 테스트 만점(/N) 변경 — 학원설정 allowTeacherTestMax on일 때만 UI 노출. 점수가 새 만점 초과면 함께 클램프.
  function setMaxFor(studentId: string, subjectName: string, which: "daily" | "check", v: number) {
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
  const markOf = (s: string): AttendanceMark =>
    s === "late" ? "지각" : s === "absent" || s === "early_leave" ? "결석" : "출석";
  function applyAttendanceLocal(
    studentId: string,
    classId: string,
    raw: string | null,
    extra?: { note?: string | null; units?: number | null },
    mark?: AttendanceMark,
  ) {
    patch(studentId, (s) => ({
      ...s,
      attendance: mark ?? (raw ? markOf(raw) : s.attendance),
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
  // 실패 롤백 — 행 raw는 되돌리되, 배지(학생단위)는 **내 낙관값이 아직 살아있을 때만** 복원(compare-and-swap).
  // 그 사이 다른 반 pill 갱신이 배지를 바꿨으면 그걸 보존한다(#17: 앞 요청 롤백이 뒤 성공 배지를 지우던 문제).
  function rollbackAttendance(
    studentId: string,
    classId: string,
    prev: { raw: string | null; note: string | null; units: number | null },
    myMark: AttendanceMark,
    prevMark: AttendanceMark,
  ) {
    patch(studentId, (s) => ({
      ...s,
      attendance: s.attendance === myMark ? prevMark : s.attendance,
      subjects: s.subjects.map((su) =>
        su.classId === classId
          ? { ...su, attendanceRaw: prev.raw, attendanceNote: prev.note, attendanceUnits: prev.units }
          : su,
      ),
    }));
  }
  // 재클릭 no-op(삭제는 출석부에서만) + (학생×반) in-flight 잠금(연속 클릭 응답 역전 방지) + 실패 롤백.
  // 낙관 갱신으로 pill 즉시 반응(반응속도 1순위) — 서버 검증(담당 반·수강생)은 setAttendanceCell이 강제.
  //
  // extra(2026-08-05) = 지각·결석 **사유 메모**·**수업타임(시수)**. 셋 다 출석부의 같은 행이라 한 왕복으로
  // 저장한다. ⚠️ 상태가 그대로여도 메모·시수만 바꾸는 호출은 **통과시켜야** 한다(예전 재클릭 no-op을 그대로
  // 두면 "지각 사유만 고치기"가 조용히 무시된다).
  async function setAttendanceFor(
    studentId: string,
    classId: string,
    status: BasicAttendance,
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
    const prevMark = stu?.attendance ?? "출석";
    const changesExtra = extra !== undefined && ("note" in extra || "units" in extra);
    if (prev.raw === status && !changesExtra) return; // 상태 재클릭 no-op(삭제는 출석부에서)
    const myMark = markOf(status);
    setAttPending((p) => new Set(p).add(key));
    // 낙관 표시용 시수 — 서버가 "1이면 null로 정규화"하므로 화면도 같은 규칙으로 미리 접는다.
    const optimisticUnits =
      extra && "units" in extra
        ? // ⚠️ 서버 parseSessionUnits는 쉼표 소수점("1,5")도 받는다 — 여기서 Number()에 그대로 넣으면 NaN이
          //    되어 화면만 1로 접히고 DB엔 1.5가 저장된다(화면과 기록이 조용히 갈린다).
          (() => {
            const n = Number(String(extra.units ?? "").replace(",", "."));
            return !Number.isFinite(n) || n === 1 ? null : n;
          })()
        : undefined;
    applyAttendanceLocal(studentId, classId, status, {
      ...(extra && "note" in extra ? { note: extra.note ?? null } : {}),
      ...(optimisticUnits !== undefined ? { units: optimisticUnits } : {}),
    });
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
        onlyIfEmpty: prev.raw === null && !opts?.overwrite,
      });
      if ("error" in res) {
        rollbackAttendance(studentId, classId, prev, myMark, prevMark);
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
          `이미 출결이 기록되어 있어 덮지 않았습니다 (현재: ${STATUS_TEXT[res.conflict.status as keyof typeof STATUS_TEXT] ?? "기록됨"}) — 바꾸려면 다시 눌러 주세요`,
        );
      }
    } catch {
      rollbackAttendance(studentId, classId, prev, myMark, prevMark);
      toast.error("출결 저장에 실패했습니다 — 네트워크를 확인해 주세요");
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
      for (const c of res.applied) applyAttendanceLocal(c.studentId, c.classId, "present");
      const missed = cells.length - res.applied.length;
      if (res.applied.length === 0) {
        // 조용한 0건 금지 — 왜 아무 일도 안 났는지 밝힌다.
        toast.message(
          "기록된 칸이 없습니다 — 이미 다른 곳에서 출결이 찍혔거나 담당 반·수강 대상이 아닙니다",
        );
        return;
      }
      toast.success(
        `일괄 출석 — ${res.applied.length}칸 기록` +
          (missed > 0
            ? ` · ${missed}칸은 그대로 뒀습니다(이미 기록됐거나 담당 반·수강 대상이 아님 — 새로고침하면 최신 기록이 보입니다)`
            : ""),
      );
    } catch {
      toast.error("일괄 출석 저장에 실패했습니다 — 네트워크를 확인해 주세요");
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
    patchRowEval(studentId, subjectName, (su) => ({ ...su, attitude: a }));
  }
  function setHomeworkValue(studentId: string, subjectName: string, h: string) {
    patchRowEval(studentId, subjectName, (su) => ({ ...su, homework: h }));
  }
  // 특이사항(강사 메모) — AI 멘트 입력(공지 모드 A/B). **행별**(보강은 다른 수업이라 메모도 다르다).
  function setNoteFor(studentId: string, subjectName: string, text: string) {
    patchRowEval(studentId, subjectName, (su) => ({ ...su, note: text }));
  }
  /**
   * 일괄 적용 전용 — 그 학생의 **모든 행**에 같은 값을 넣는다(보강 행 포함).
   * 🔴 원장 2026-08-13: *"일괄 적용은 말 그대로 일괄 적용이기 때문에 보강에도 적용시켜. 다만 선생님이
   *    수정할 수 있겠지. 일괄 적용됐는데 보강만 적용 안 된다는건 일괄 적용이 아님."*
   *    적용 후 행별로 다르게 하고 싶으면 강사가 그 행에서 고친다.
   */
  function applyToAllRows(studentId: string, up: (su: Subject) => Subject) {
    patch(studentId, (s) => ({ ...s, subjects: s.subjects.map((su) => up(seedRowFields(s, su))) }));
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
    patchReport(studentId, subjectName, (r) => ({ ...r, draft: text }));
  }
  function setSubjectDraft(subjectName: string, text: string) {
    if (!selected) return;
    setDraftFor(selected.id, subjectName, text);
  }
  // 학습 추세(종합분석) 초안 편집 — 멘트(draft)와 별개 필드(4a).
  function setTrendDraftFor(studentId: string, subjectName: string, text: string) {
    patchReport(studentId, subjectName, (r) => ({ ...r, trendDraft: text }));
  }
  function setSubjectTrend(subjectName: string, text: string) {
    if (!selected) return;
    setTrendDraftFor(selected.id, subjectName, text);
  }
  // 교재명·보강 — 과목별(subjectName으로 해당 과목만 갱신). 자동저장(patch→queueSave)에 실림.
  function setTextbookFor(studentId: string, subjectName: string, text: string) {
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
  // 오늘 과제(숙제 내용) — 과목별(0096a). 자동저장에 실리고 AI 멘트·학부모 카드 재료.
  function setHomeworkTodayFor(studentId: string, subjectName: string, text: string) {
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
    if (!selected) return;
    const su = selected.subjects[subjectIndex];
    const sheet = su?.sheetDraft;
    if (!su || !sheet) return;
    if (sheet.progress) setProgressFor(selected.id, subjectIndex, sheet.progress);
    if (sheet.textbook) setTextbookFor(selected.id, su.name, sheet.textbook);
    if (sheet.homework) setHomeworkTodayFor(selected.id, su.name, sheet.homework);
  }
  // AI 학부모 멘트 + 학습 추세 생성 코어(카드·표 공용) — 멘트 실패 시 결정적 템플릿 폴백,
  // 추세는 표본 부족/실패면 조용히 생략(기존 값 유지). 둘을 학생별 병렬(Promise.all)로 생성해 지연 최소화.
  async function generateDraftFor(student: OneScreenStudent, subjectName: string) {
    if (readonlyView) return; // 조용히 — 상위 진입(autoWrite*)이 이미 토스트를 띄운다(일괄이면 N개가 쌓인다)
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    if (idx < 0) return;
    const su = student.subjects[idx];
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
    try {
      // 통합 1회 호출 — 멘트 + 추세를 한 번에 생성(비용·지연↓).
      const res = await generateReportComment({ ...buildReportCommentInput(student, idx, classNotices), classContext }, {
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
      const text = res.ok && res.comment ? res.comment : buildSubjectReport(student, idx);
      if (!res.ok) toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        // 작성 방식 스냅샷(0214a) — AI 성공분·템플릿 폴백 모두 "자동이 넣은 텍스트". 저장 시 draft와 비교.
        autoDraft: text,
        // 추세는 생성 성공 시에만 갱신(표본 부족·실패면 기존 초안·수동 입력 보존).
        ...(res.ok && res.trend ? { trendDraft: res.trend } : {}),
      }));
    } catch {
      const fallback = buildSubjectReport(student, idx);
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: fallback, autoDraft: fallback }));
      toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
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
    const all = buildGridRows(visible)
      .filter((r) => rowInClass(r.subject, activeClassFilter)) // 특정 반이면 그 반 행만(타 반 혼입 차단)
      .filter((r) =>
        isRowActionable(
          r.subject,
          action,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
          { attendanceReadOnly: !canEditAttendance }, // 출결 쓰기 권한 없음 = 미체크 게이트 해당 없음(P0-3)
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
    const hasDraft = (r: (typeof eligible)[number]) =>
      !!reportsRef.current[r.student.id]?.[r.subject.name]?.draft?.trim();
    const rows = eligible.filter((r) => !hasDraft(r));
    const preserved = eligible.length - rows.length;
    if (rows.length === 0) {
      toast.message(
        preserved
          ? `자동작성할 새 행이 없습니다 — 멘트 있는 ${preserved}건은 보존(개별 '자동작성'으로 재생성)`
          : "자동작성할 행이 없습니다 — 오늘 진도를 입력하세요",
      );
      return;
    }
    setBulkGen(true);
    try {
      for (const r of rows) {
        setGenKey(`${r.student.id}::${r.subject.name}`);
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        await generateDraftFor(student, r.subject.name);
      }
    } finally {
      setGenKey(null);
      setBulkGen(false);
    }
    toast.success(
      `${rows.length}건 자동작성 완료` +
        (preserved ? ` · 멘트 보존 ${preserved}건` : "") +
        (skipped ? ` · 건너뜀 ${skipped}(진도 미입력·결석)` : ""),
    );
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
  ) {
    const all = buildGridRows(visible).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const plan = planBulkApply(
      rows.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        today: r.subject.today ?? "",
        attitude: r.student.attitude,
        homework: r.student.homework,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
        // 잠긴 행(발송 완료·결석)엔 값을 밀어 넣지 않는다 — 넣으면 강사가 **지울 수 없는 값**이 남는다.
        // ⚠️ 행 목록(rows)에서 빼지는 않는다: 아래 출결 일괄 적용이 같은 목록을 쓰는데 거기서 빠지면
        //    잘못 찍은 결석을 일괄로 되돌릴 수 없다(잠금의 유일한 탈출구를 막는 꼴).
        locked:
          readonlyView ||
          !isRowInputEditable(
            r.subject,
            effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
          ),
      })),
      patchFields,
      onlyEmpty,
      progressSubjectKey,
    );
    // 값 칸은 먼저 즉시 반영(출결 왕복을 기다리게 하지 않는다).
    for (const p of plan) {
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) applyToAllRows(p.studentId, (su) => ({ ...su, attitude: p.set.attitude! }));
      if (p.set.homework !== undefined) applyToAllRows(p.studentId, (su) => ({ ...su, homework: p.set.homework! }));
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
    }
    const done: string[] = [];
    if (plan.length) done.push(`${plan.length}행 입력`);

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
      const why = describeAttendanceSkips(attPlan);
      if (attPlan.cells.length === 0) {
        done.push(`출결 0건${why ? `(제외: ${why})` : ""}`);
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
                c.created && echoUnits !== undefined ? { units: echoUnits } : undefined,
              );
            done.push(
              `출결 ${res.applied.length}건 기록` +
                (res.blocked ? ` (담당 반·수강생이 아니어서 ${res.blocked}건 제외)` : "") +
                (why ? ` · 제외 ${why}` : ""),
            );
          }
        } catch {
          toast.error("출결 저장에 실패했습니다 — 네트워크를 확인해 주세요");
        } finally {
          setAttPending((p) => {
            const n = new Set(p);
            attKeys.forEach((k) => n.delete(k));
            return n;
          });
        }
      }
    }
    if (done.length === 0) {
      toast.message("적용할 칸이 없습니다");
      return;
    }
    toast.success(`일괄 적용 — ${done.join(" · ")}`);
  }
  /**
   * 맨 위 행의 **수업 내용**(진도·교재·오늘 과제)을 아래 행 전부에 복사.
   * 대상 = 선택 행이 있으면 그 행들, 없으면 표시 전체(반 필터 반영) — 다른 일괄 작업과 같은 규약.
   * ⚠️ 점수·태도·과제 수행·학부모 문구는 **복사하지 않는다**(학생마다 다른 개별 사실 — grid.ts 주석 참조).
   */
  function copyFirstRowDown(keys: string[], overwrite: boolean) {
    if (readonlyBlocked()) return; // #103 세 뒷문 중 하나 — 잠긴 화면에 값을 밀어 넣는 경로
    const all = buildGridRows(visible).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const [first, ...rest] = rows;
    if (!first || rest.length === 0) {
      toast.message("복사할 아래 행이 없습니다");
      return;
    }
    const res = planCopyFirstRow(
      {
        subjectKey: first.subject.subjectKey ?? "math",
        today: first.subject.today ?? "",
        textbook: first.subject.textbook ?? "",
        homeworkToday: first.subject.homeworkToday ?? "",
      },
      rest.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        today: r.subject.today ?? "",
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
        // ⚠️ 이 카운터엔 결석 행도 들어온다(2026-08-07) — "발송 완료 N행"만 적으면 거짓말이 된다.
        res.skippedSent ? `발송 완료·결석 ${res.skippedSent}행` : "",
        res.skippedSubject ? `다른 과목 ${res.skippedSubject}행` : "",
        res.skippedFilled ? `이미 입력됨 ${res.skippedFilled}행` : "",
      ].filter(Boolean);
      toast.message(why.length ? `복사할 칸이 없습니다 — ${why.join(" · ")}` : "맨 위 행에 먼저 진도를 입력하세요");
      return;
    }
    for (const p of res.plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
    }
    const skipped = res.skippedSent + res.skippedSubject + res.skippedFilled;
    toast.success(
      `${first.student.name} 행을 ${res.plan.length}행에 복사했습니다` +
        (skipped
          ? ` · 건너뜀 ${skipped}행(${[
              res.skippedSent ? `발송완료·결석 ${res.skippedSent}` : "",
              res.skippedSubject ? `다른 과목 ${res.skippedSubject}` : "",
              res.skippedFilled ? `이미 입력 ${res.skippedFilled}` : "",
            ]
              .filter(Boolean)
              .join(", ")})`
          : ""),
    );
  }
  // 이전 회차 가져오기(1-3) — 그 행의 **빈 칸만** 채움(진도·태도·과제·오늘 과제).
  // ⚠️ 특이사항은 채우지 않음 — prevReport.note는 학부모 발송 본문(notes)이라 특이사항이 아니다.
  function importPrevFor(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return; // 참고행 '가져오기' — LOCK_FS 밖 버튼이라 여기서 끊는다
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    if (!su) return;
    const fill = planPrevFill({
      prev: su.prevReport,
      current: {
        today: su.today,
        attitude: student.attitude,
        homework: student.homework,
        homeworkToday: su.homeworkToday ?? "",
      },
      attitudes: ATTITUDE,
    });
    const count = Object.keys(fill).length;
    if (!count) {
      toast.message("가져올 빈 칸이 없습니다 — 이미 입력됐거나 이전 회차 값이 없습니다");
      return;
    }
    if (fill.today !== undefined) setProgressFor(student.id, idx, fill.today);
    if (fill.attitude !== undefined) applyToAllRows(student.id, (su) => ({ ...su, attitude: fill.attitude! }));
    if (fill.homework !== undefined) applyToAllRows(student.id, (su) => ({ ...su, homework: fill.homework! }));
    if (fill.homeworkToday !== undefined) setHomeworkTodayFor(student.id, subjectName, fill.homeworkToday);
    toast.success(`이전 회차 값으로 빈 칸 ${count}개를 가져왔습니다`);
  }
  // 이전 회차 **일괄** 가져오기(G5 얕은판) — 표시(또는 선택) 전 행에 planPrevFill을 돌려 빈 칸만 채운다.
  // bulkApplyValues 대칭(대상 선정 규약 동일: keys 미선택=표시 전체, rowInClass 필터). 행별 importPrevFor와
  // 같은 순수 계획 함수를 쓰므로 특이사항·교재 제외(발송 본문 오염 방지·roster 자동 승계) 결정이 자동 준수된다.
  // "평소와 같음" 기본값의 얕은 구현 — 강사는 일괄로 깔고 달라진 학생만 손댄다(깊은판 provenance는 G4에서).
  // ⚠️ 멘트(학부모 문구)만 예외로 **확인 다이얼로그**를 거친다 — 나머지 칸은 강사가 오늘 값을 고르는 입력이지만
  // 멘트는 직전에 이미 학부모에게 나간 문장이라, 오늘 진도·점수와 어긋난 채 그대로 발송될 위험이 있다(원장 지시 07-21).
  function bulkImportPrev(keys?: string[]) {
    if (readonlyBlocked()) return; // 값 계획은 locked로 0건이지만 **멘트 계획**은 별도 경로라 입구에서 차단
    const all = buildGridRows(visible).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys ?? []);
    const rows = keySet.size ? all.filter((r) => keySet.has(r.key)) : all;
    // 계획은 순수 함수(planBulkPrevFill)가 세운다 — 태도·과제는 **학생 단위** 값이라 다과목 학생에서
    // 과목 행마다 덮어쓰지 않도록 학생당 1회로 dedup(자세한 배경은 grid.ts 주석).
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
              attitude: r.student.attitude,
              homework: r.student.homework,
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
    const commentPlan = planPrevComments(
      rows.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        prevNote: r.student.subjects.find((su) => su.name === r.subject.name)?.prevReport?.note,
        // ⚠️ 초안은 ref에서 — 진행 중이던 자동작성이 방금 채운 멘트를 클릭 시점 스냅샷이 못 봐 덮어쓰는 것 방지(#10).
        currentDraft: reportsRef.current[r.student.id]?.[r.subject.name]?.draft ?? "",
      })),
    );
    if (!plan.length && !commentPlan.length) {
      toast.message("가져올 빈 칸이 없습니다 — 이미 입력됐거나 이전 회차 값이 없습니다");
      return;
    }
    let filledCells = 0;
    for (const p of plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) applyToAllRows(p.studentId, (su) => ({ ...su, attitude: p.set.attitude! }));
      if (p.set.homework !== undefined) applyToAllRows(p.studentId, (su) => ({ ...su, homework: p.set.homework! }));
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      filledCells += Object.keys(p.set).length;
    }
    if (plan.length) {
      toast.success(`${plan.length}행의 빈 칸 ${filledCells}개를 이전 회차 값으로 가져왔습니다 (특이사항 제외)`);
    }
    if (commentPlan.length) setPrevCommentPlan(commentPlan); // → 확인 다이얼로그
  }
  /** 확인 다이얼로그 '멘트도 가져오기' — 계획대로 초안만 채운다(다른 칸은 위에서 이미 처리됨). */
  function applyPrevComments() {
    const plan = prevCommentPlan ?? [];
    setPrevCommentPlan(null);
    if (!plan.length) return;
    // 🔴 복사 삽입도 autoDraft 스냅샷을 함께 남긴다(0214a, 적대 리뷰 확정) — 직전 회차 문구는 AI 유래일 수
    //    있고 아니어도 "지금 직접 쓴" 문장이 아니다. setDraftFor(초안만)로 넣으면 그대로 저장 시 manual로
    //    오표기돼 말투 코퍼스가 오염된다(중복 유입 포함). 스냅샷을 남기면 그대로=auto, 고치면=auto_edited.
    for (const p of plan)
      patchReport(p.studentId, p.subjectName, (r) => ({ ...r, draft: p.comment, autoDraft: p.comment }));
    toast.success(`${plan.length}행의 멘트를 직전 회차 문구로 가져왔습니다 — 발송 전에 오늘 내용과 맞는지 확인하세요`);
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
    toast.success("학생 순서를 저장했습니다 — 다음 작성에도 유지됩니다");
    return true;
  }
  // 표 행 → 카드로 열기(그 학생 선택 + 카드 뷰). 본문 편집·첨부·링크 관리·PDF는 카드에서.
  function openCard(studentId: string) {
    setSelId(studentId);
    setView("card");
  }
  // 학부모 공지 진입 — 카드=선택 학생 1명, 표=선택 행(없으면 보이는 전체) 학생. 공지 뷰로 전환하며 대상 seed.
  function openNoticeForStudent(studentId: string) {
    if (readonlyBlocked()) return; // 공지 뷰는 순수 작성 화면 — 열람 전용에선 열 이유가 없다(발송은 서버도 거절)
    setNoticeSeed([studentId]);
    setView("notice");
  }
  function openNoticeForRows(keys?: string[]) {
    if (readonlyBlocked()) return; // openNoticeForStudent와 동일
    const ids =
      keys && keys.length
        ? [...new Set(keys.map((k) => k.split("::")[0]!))]
        : visible.map((s) => s.id);
    setNoticeSeed(ids);
    setView("notice");
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
    const draft = existing?.draft ?? "";
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
      trendDraft: existing?.trendDraft,
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
        // 멘트 작성 방식(0214a) — 이번 세션 자동작성 스냅샷과 비교(최종은 서버 resolveMentSource가 sticky 판정).
        mentSource: computeClientMentSource(draft, existing?.autoDraft),
      },
    };
  }
  // 보고서 저장 시 그 학생 진도를 확정 처리 — 표 모드엔 카드의 '진도 확정' 버튼이 없어 상단 진도·마감 지표가
  // 0에 고정되던 문제(#13). 이미 확정이면 no-op(불필요한 autosave 방지).
  function confirmProgressOnSave(studentId: string) {
    const cur = studentsRef.current.find((s) => s.id === studentId);
    if (cur && !cur.progressConfirmed) patch(studentId, (s) => ({ ...s, progressConfirmed: true }));
  }
  // ── 저장·발송 코어(카드·표 공용) — (학생,과목) 저장/큐잉 + reports state 반영. ──
  async function saveRecord(student: OneScreenStudent, subjectName: string) {
    // 이중 방어(진입부들이 이미 막지만 새 진입부 대비) — 호출부가 res를 바로 쓰므로 실패 객체로 반환.
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const built = buildSaveInputFor(student, subjectName);
    const res = await saveLessonReport(built.input);
    if (res.ok) {
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
  async function queueOne(student: OneScreenStudent, subjectName: string) {
    // 이중 방어 — saveRecord와 같은 이유(호출부 계약 유지: 실패 객체 반환).
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const built = buildSaveInputFor(student, subjectName);
    const res = await saveAndQueueClassnote(built.input);
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
    }
    return res;
  }

  async function sendSubject(subjectName: string, channel: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
      return;
    }
    // 진도 미입력 게이트(방어층) — 버튼 disabled 우회·프로그램 호출 대비. 표뷰와 동일 기준(#15 확정).
    const su = selected.subjects.find((s) => s.name === subjectName);
    if (su && !isRowActionable(su, "save")) {
      toast.message("오늘 진도를 먼저 입력하세요");
      return;
    }
    const res = await saveRecord(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? "보고서 저장에 실패했습니다");
      return;
    }
    // 채널은 pdf(인쇄 미리보기 창)·save(기록 저장)뿐. 카톡·문자 자동발송(알림톡)은 후속 —
    // 지금은 저장 후 하단 '학부모 공유 링크' 복사로 수동 전달(별도 버튼 제거).
    if (channel === "pdf" && res.id) {
      openPrint({
        id: `print/lesson_reports/${res.id}`,
        href: `/lesson_reports/${res.id}/print`,
        title: "수업 보고서",
      });
      toast.success(`${subjectName} 보고서 저장 — 미리보기를 열었습니다`);
    } else {
      toast.success(`${subjectName} 보고서를 기록에 저장했습니다`);
    }
  }

  // ClassNote 발송(카드) — 저장 + 큐 적재. 실제 게시는 로컬 워커가 백그라운드로(강사는 대기 안 함).
  async function queueClassnote(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
      return;
    }
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 표 sendRow와 동일. 워커 최종 관문이 무조건 차단하므로
    // 여기서 큐잉해 봐야 "발송 대기" 표시 후 실패로 뒤집히는 혼란만 남는다. 이유를 즉시 말하고 막는다.
    if (!(reports[selected.id]?.[subjectName]?.draft ?? "").trim()) {
      toast.error(`${subjectName} — 학부모 전달 멘트가 비어 있어 발송할 수 없습니다 (자동 작성 또는 직접 입력 후 발송)`);
      return;
    }
    const res = await queueOne(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? "ClassNote 발송 큐 적재에 실패했습니다");
      return;
    }
    if (res.status === "recall_pending") {
      toast.error(`${subjectName} — 회수 처리 중입니다. 게시글 삭제가 끝난 뒤에 보내세요`);
      return;
    }
    if (res.status === "revoked") {
      toast.error(`${subjectName} — 취소된 링크입니다. 재발급 후 발송하세요`);
      return;
    }
    if (res.status === "name_conflict") {
      toast.error(
        `${subjectName} — 동명이인이 있어 자동 발송을 막았습니다. 학생 관리에서 'ClassNote 이름'을 구분(예: "홍길동(중2)") 지정 후 다시 발송하세요`,
      );
      return;
    }
    if (res.status === "dry_run") {
      toast.message(`${subjectName} — 저장됨(dry-run). 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 실제 전송됩니다`);
      return;
    }
    // 발송 대상 과목이 아님(원장 설정 classnoteSubjects 밖) — 저장만 되고 큐에 안 들어감. 성공으로 오인 방지.
    if (res.status === "subject_off") {
      toast.message(`${subjectName} — 저장했지만 이 과목은 발송 대상이 아니라 전송하지 않았습니다(원장 설정의 발송 과목 확인)`);
      return;
    }
    // 결석 게이트(#77 서버판) — 버튼 disabled를 우회한 경로(반 모호 행·stale 화면)도 서버가 막는다.
    if (res.status === "absent") {
      toast.message(`${subjectName} — 수업일 출결이 결석으로 기록돼 있어 발송하지 않았습니다(기록 저장은 유지)`);
      return;
    }
    // 출결 미체크 게이트(서버판, 2026-08-17) — 여기서 안 잡으면 아래 폴스루가 "대기 중" 성공 토스트를
    // 띄운다(서버가 방금 거절한 발송을 성공으로 오인 — 적대 리뷰 확정). 표 sendRow와 동일 안내.
    if (res.status === "no_attendance") {
      toast.message(`${subjectName} — 출결이 아직 체크되지 않아 발송하지 않았습니다(출결 기록 후 다시 발송 · 저장은 유지)`);
      return;
    }
    // 이미 게시된 건(중복 게시 차단) — 저장도 안 했으므로 "내용을 고쳤다면 저장부터"를 함께 안내한다.
    if (res.status === "already_sent") {
      toast.message(
        `${subjectName} — 이미 학부모에게 발송된 보고서라 다시 보내지 않았습니다. 내용을 고쳤다면 '저장'을 누르세요`,
      );
      return;
    }
    const msg =
      res.status === "queued"
        ? res.sendWindowHint
          ? `발송 예약됨 — 허용 시간대(${res.sendWindowHint})에 자동 발송됩니다`
          : "발송 대기 — 워커가 자동으로 게시합니다"
        : res.status === "success"
          ? "이미 발송 완료된 보고서입니다"
          : res.status === "processing"
            ? "이미 처리 중입니다"
            : res.status === "too_old"
              ? "오래된 보고서라 발송에서 제외됩니다"
              : "대기 중";
    toast.success(`${subjectName} ClassNote — ${msg}`);
  }

  // ── 표(그리드) 행별/일괄 — 카드와 같은 코어(queueOne/saveRecord) 재사용. 오늘 진도 있는 행만. ──
  async function sendRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) {
      toast.message("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
      return;
    }
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 워커 최종 관문이 무조건 차단하므로(빈 보고서가
    // 학부모에게 노출된 이날 사고) 여기서 보내봐야 실패 예약일 뿐이다. 이유를 즉시 말하고 막는다.
    if (!(reports[student.id]?.[subjectName]?.draft ?? "").trim()) {
      toast.error(`${student.name} — 학부모 전달 멘트가 비어 있어 발송할 수 없습니다 (자동작성 또는 직접 입력 후 발송)`);
      return;
    }
    const res = await queueOne(student, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    if (res.status === "name_conflict") {
      toast.error(`${student.name} — 동명이인이 있어 발송을 막았습니다(학생 관리에서 ClassNote 이름 지정)`);
    } else if (res.status === "recall_pending") {
      toast.error(`${student.name} — 회수 처리 중입니다(삭제 후 발송)`);
    } else if (res.status === "revoked") {
      toast.error(`${student.name} — 취소된 링크입니다(재발급 필요)`);
    } else if (res.status === "too_old") {
      toast.message(`${student.name} — 오래된 보고서라 발송에서 제외됩니다`);
    } else if (res.status === "dry_run") {
      toast.message(`${student.name} — 저장됨(dry-run · 승인 전 실제 발송 안 함)`);
    } else if (res.status === "subject_off") {
      // 발송 대상 과목이 아님 — 저장만 됨. "발송 대기" 성공 오안내 방지(#2 확정).
      toast.message(`${student.name} ${subjectName} — 저장했지만 발송 대상 과목이 아니라 전송하지 않았습니다`);
    } else if (res.status === "absent") {
      // 결석 게이트(#77 서버판) — 반 모호(attendanceRaw 미채움) 행 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(`${student.name} — 수업일 출결이 결석으로 기록돼 있어 발송하지 않았습니다(기록 저장은 유지)`);
    } else if (res.status === "no_attendance") {
      // 출결 미체크 게이트(서버판, 2026-08-17) — stale 화면 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(`${student.name} — 출결이 아직 체크되지 않아 발송하지 않았습니다(출결 기록 후 다시 발송 · 저장은 유지)`);
    } else if (res.status === "already_sent") {
      // 중복 게시 차단(서버판) — 화면 게이트를 지난 경로(stale 화면·다른 창에서 먼저 발송)도 서버가 막는다.
      toast.message(`${student.name} ${subjectName} — 이미 학부모에게 발송된 보고서라 다시 보내지 않았습니다`);
    } else if (res.status === "queued" && res.sendWindowHint) {
      // 발송 허용 시간창 밖 — 큐엔 정상 적재, 워커가 창 진입 시 자동 발송("왜 안 나가지?" 재발송 혼란 방지).
      toast.success(`${student.name} ${subjectName} — 발송 예약됨(${res.sendWindowHint}에 자동 발송)`);
    } else {
      toast.success(`${student.name} ${subjectName} — 발송 대기`);
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
          ? `저장할 행이 없습니다 — 이미 발송된 ${sentRowCount}건은 수정할 수 없습니다(진도 미입력 행도 제외)`
          : "저장할 행이 없습니다 — 오늘 진도를 입력하세요",
      );
      return;
    }
    setBulkBusy("save");
    let ok = 0;
    let fail = 0;
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await saveRecord(student, r.subject.name);
        if (res.ok) ok++;
        else fail++;
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      `${ok}건 저장 완료${fail ? ` · ${fail}건 실패` : ""}${skipped ? ` · 건너뜀 ${skipped}(진도 미입력)` : ""}`,
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
    const allRows = buildGridRows(visible).filter((r) => rowInClass(r.subject, activeClassFilter));
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
          ? `발송할 새 행이 없습니다 — ${alreadySentRows}건은 이미 학부모에게 발송됐습니다`
          : "발송할 행이 없습니다 — 오늘 진도를 입력하세요 (결석·출결 미체크 행은 발송 제외)",
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
        !isReportEligible(r.subject),
    );
    const noProgressNames = [...new Set(noProgressRows.map((r) => r.student.name))];
    const progressLine = noProgressRows.length
      ? `\n진도 미입력 ${noProgressRows.length}건은 발송에서 제외됩니다 — ${noProgressNames.slice(0, 5).join(", ")}${
          noProgressNames.length > 5 ? ` 외 ${noProgressNames.length - 5}명` : ""
        } (진도 입력 후 다시 발송하세요)`
      : "";
    // 출결 미체크 제외(2026-08-17 원장 지시) — 진도·멘트와 같은 규약: 소리 없는 제외 금지, 누구인지 명시.
    // "미체크만 아니면 발송됐을 행" = autowrite 판정(진도 있음·미발송·결석 아님)과 정확히 같은 집합이라
    // 게이트 함수를 재사용한다(조건 체인을 손으로 복제하면 게이트가 바뀔 때 이 카운트만 조용히 어긋난다, #89류).
    // 진도 미입력 행은 위 progressLine이 이미 셌으므로 여기 안 겹친다(한 행 중복 계수 방지).
    const uncheckedRows = allRows.filter(
      (r) =>
        canEditAttendance && // 출결 쓰기 권한 없음 = 게이트 해당 없음(P0-3) — 제외 안내도 하지 않는다
        (!keySet || keySet.has(r.key)) &&
        isRowActionable(r.subject, "autowrite", effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus)) &&
        isAttendanceUnchecked(r.subject),
    );
    const uncheckedNames = [...new Set(uncheckedRows.map((r) => r.student.name))];
    const uncheckedLine = uncheckedRows.length
      ? `\n출결 미체크 ${uncheckedRows.length}건은 발송에서 제외됩니다 — ${uncheckedNames.slice(0, 5).join(", ")}${
          uncheckedNames.length > 5 ? ` 외 ${uncheckedNames.length - 5}명` : ""
        } (출결 체크 후 다시 발송하세요)`
      : "";
    const gaps = summarizeSendGaps(rows, { dailyEnabled: showDailyTest, checkEnabled: showCheckTest });
    const gapLine =
      gaps.missingAttitude || gaps.missingTest
        ? `\n태도 미입력 ${gaps.missingAttitude}명 · 테스트 미입력 ${gaps.missingTest}명 — 미입력 항목은 보고서에서 생략됩니다`
        : "";
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 멘트 없는 행은 **발송 대상에서 제외**한다(워커
    // 최종 관문도 무조건 차단 — 이날 빈 보고서 22건이 학부모에게 노출된 사고). confirm에 누구인지 명시.
    const emptyMentRows = rows.filter((r) => !(reports[r.student.id]?.[r.subject.name]?.draft ?? "").trim());
    rows = rows.filter((r) => (reports[r.student.id]?.[r.subject.name]?.draft ?? "").trim());
    const emptyMentNames = [...new Set(emptyMentRows.map((r) => r.student.name))];
    const emptyMentLine = emptyMentRows.length
      ? `\n멘트 미작성 ${emptyMentRows.length}건은 발송에서 제외됩니다 — ${emptyMentNames.slice(0, 5).join(", ")}${
          emptyMentNames.length > 5 ? ` 외 ${emptyMentNames.length - 5}명` : ""
        } (멘트 작성 후 다시 발송하세요)`
      : "";
    if (rows.length === 0) {
      toast.message(`발송할 행이 없습니다 — 멘트 미작성 ${emptyMentRows.length}건 전부 제외됐습니다 (자동작성 또는 직접 입력 후 발송)`);
      return;
    }
    const absentLine = absentRows ? `\n결석 행 ${absentRows}건은 발송에서 제외됩니다` : "";
    const sentLine = alreadySentRows
      ? `\n이미 발송된 ${alreadySentRows}건은 제외됩니다 — ClassNote는 게시글 수정이 안 돼 다시 보내면 글만 하나 더 붙습니다`
      : "";
    if (
      !window.confirm(
        `${rows.length}건을 ClassNote로 일괄 발송할까요? (동명이인·취소·오래된 건은 자동 제외)${emptyMentLine}${progressLine}${uncheckedLine}${gapLine}${absentLine}${sentLine}`,
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
    let sentSkip = 0; // 서버 중복 게시 가드에 걸린 행(다른 창에서 먼저 보낸 경우 등)
    let dry = 0;
    let fail = 0;
    let windowHint = ""; // 발송 허용 시간창 밖 큐잉 — 마지막 응답의 창 라벨(테넌트 단일 설정이라 동일)
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await queueOne(student, r.subject.name);
        if (!res.ok) fail++;
        else if (res.status === "queued") {
          queued++;
          if (res.sendWindowHint) windowHint = res.sendWindowHint;
        } else if (res.status === "dry_run") dry++;
        else if (res.status === "subject_off") subjectOff++;
        else if (res.status === "name_conflict" || res.status === "revoked" || res.status === "recall_pending") blocked++;
        else if (res.status === "absent") absentSkip++; // 서버 결석 게이트(클라 사전 필터를 지난 반 모호 행 등)
        else if (res.status === "no_attendance") uncheckedSkip++; // 서버 출결 미체크 게이트(stale 화면 등)
        else if (res.status === "already_sent") sentSkip++; // 서버 중복 게시 가드(클라 게이트를 지난 stale 행)
        else skipped++; // processing/too_old
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      (dry ? `저장 ${dry}건(dry-run·발송 안 함) · ` : "") +
        (windowHint ? `발송 예약 ${queued}건(${windowHint}에 자동 발송)` : `발송 대기 ${queued}건`) +
        (subjectOff ? ` · 과목 제외 ${subjectOff}건(발송 대상 과목 아님)` : "") +
        (absentSkip ? ` · 결석 제외 ${absentSkip}건` : "") +
        (uncheckedSkip ? ` · 출결 미체크 제외 ${uncheckedSkip}건` : "") +
        (alreadySentRows || sentSkip ? ` · 발송완료 제외 ${alreadySentRows + sentSkip}건` : "") +
        (blocked ? ` · 차단 ${blocked}건(동명이인/취소)` : "") +
        (skipped ? ` · 제외 ${skipped}건` : "") +
        (preSkipped ? ` · 대상 제외 ${preSkipped}건(진도 미입력·출결 미체크·결석·발송완료)` : "") +
        (fail ? ` · 실패 ${fail}건` : ""),
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
      toast.error(res.error ?? "링크 취소에 실패했습니다");
      return;
    }
    patchReport(student.id, subjectName, (r) => ({ ...r, revoked: true }));
    toast.success(`${subjectName} 공유 링크를 취소했습니다 — 학부모 열람이 차단됩니다`);
  }

  // 공유링크 재발급(reissue) — 새 토큰. 옛 링크(카톡/문자/ClassNote 게시)는 즉시 무효화되므로 확인 후 실행.
  async function reissueShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    if (!window.confirm("이미 전달·게시된 옛 링크는 즉시 열리지 않게 됩니다. 새 링크를 발급할까요?")) return;
    const student = selected;
    const res = await reissueShareLink(token);
    if (!res.ok || !res.shareToken) {
      toast.error(res.error ?? "링크 재발급에 실패했습니다");
      return;
    }
    // 새 토큰 반영 + 취소·ClassNote 상태 초기화(재발급=미발송으로 되돌림).
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      shareToken: res.shareToken,
      revoked: false,
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
    }));
    toast.success(`${subjectName} 공유 링크를 재발급했습니다 — 새 링크를 다시 전달하세요`);
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
    if (su0 && !reports[student.id]?.[subjectName]?.sent && !isRowActionable(su0, "save")) {
      if (!opts?.silent) toast.message("오늘 진도를 입력한 뒤 첨부하세요");
      return 0;
    }
    const studentId = student.id;
    const subject = subjectKeyFor(student, subjectName);
    setUploadingAttKey(rowKey(studentId, subjectName));
    let added = 0;
    try {
      // 첨부 먼저 UX — 미저장 상태면 현재 초안으로 자동저장해 보고서 행을 먼저 만든다(첨부는 저장된 행에만).
      // 수동 '저장' 클릭을 없앨 뿐 결과는 "저장 후 첨부"와 동일(진짜 저장된 행).
      if (!reports[studentId]?.[subjectName]?.sent) {
        const built = buildSaveInputFor(student, subjectName);
        if (!built) {
          toast.error("저장할 보고서 정보를 찾을 수 없습니다");
          return 0;
        }
        const saved = await saveLessonReport(built.input);
        if (!saved.ok || !saved.id) {
          toast.error(saved.error ?? "보고서 저장에 실패했습니다");
          return 0;
        }
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
          toast.error(issued.error ?? "업로드 준비에 실패했습니다");
          break;
        }
        try {
          await uploadToTicket(issued.ticket, file);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "업로드에 실패했습니다");
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
          toast.error(reg.error ?? "첨부 등록에 실패했습니다");
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
        if (!opts?.silent) toast.success(`${added}개 첨부 — ClassNote는 다시 발송하세요`);
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

  async function removeAttachmentFor(student: OneScreenStudent, subjectName: string, path: string) {
    if (readonlyBlocked()) return;
    const studentId = student.id;
    const res = await removeReportAttachment({
      studentId,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
      path,
    });
    if (!res.ok) {
      toast.error(res.error ?? "첨부 삭제에 실패했습니다");
      return;
    }
    patchReport(studentId, subjectName, (r) => ({
      ...r,
      attachments: res.attachments ?? [],
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
    }));
    setAttUrls((prev) => {
      const n = { ...prev };
      delete n[path];
      return n;
    });
    toast.success("첨부를 삭제했습니다");
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
    if (rows === 0) toast.message("첨부된 행이 없습니다 — 진도를 입력한 행에만 첨부됩니다");
    else {
      const skipped = targets.length - rows;
      toast.success(
        `${rows}개 행에 ${added}개 첨부${skipped ? ` · ${skipped}행 건너뜀(진도 미입력·상한)` : ""} — ClassNote는 다시 발송하세요`,
      );
    }
  }

  return (
    // 🔴 한 화면 고정(2026-08-06 원장): *"전체 창 크기를 가운데 보고서에 맞추고, 넘치는 부분은 스크롤 처리하도록
    //    각 섹션을 3개화"*. 셸 <main>이 이미 높이가 확정된 스크롤 컨테이너라 여기서 `h-full`로 그 높이를 받고,
    //    아래 3열이 남은 높이를 통째로 가져간 뒤 **열마다 따로** 스크롤한다(출석부 '한 화면 시트'와 같은 배치).
    //    ⚠️ `min-h-0`이 없으면 flex 아이템의 최소 크기가 콘텐츠라 열이 창을 넘겨 밀어낸다.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <OneScreenTopBar
        readonlyView={readonlyView}
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
        doneCount={doneCount}
        total={students.length}
        view={view}
        onView={setView}
        stats={hubStats}
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

      {/* 그 요일에 담당 수업이 없을 때 — 예전엔 담당 반 전체가 '오늘 목록'처럼 떴다(2026-07-22 이수진 수요일:
          반 7개·학생 37명). 이제 목록 대신 사실을 말하고, 전체 보기는 **누를 때만** 연다. */}
      {noClassesToday && !showingAll ? (
        <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]">
          <span className="text-foreground font-bold">이 날짜에는 담당 수업이 없습니다</span>
          <span>— 다른 날짜를 고르거나, 필요하면 담당 반 전체를 볼 수 있습니다.</span>
          <a
            href={`/onescreen?date=${date}&all=1${view === "card" ? "" : `&view=${view}`}`}
            className="text-primary font-bold underline underline-offset-2"
          >
            담당 반 전체 보기
          </a>
        </div>
      ) : null}
      {showingAll ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]">
          <span className="font-bold">담당 반 전체 보기 — 이 날짜에 수업이 있는 학생이 아닙니다</span>
          <span>안 오는 날 입력·발송이 되지 않도록 주의하세요.</span>
          <a
            href={`/onescreen?date=${date}${view === "card" ? "" : `&view=${view}`}`}
            className="font-bold underline underline-offset-2"
          >
            오늘 수업만 보기
          </a>
        </div>
      ) : null}

      {/* 발송 완료 안내(2026-07-22 원장 지시) — **과거 날짜로 돌아갔을 때가 핵심**이다.
          그 날짜는 대부분 이미 발송이 끝나 있는데, 화면은 평소와 똑같이 보이고 발송 버튼도 그냥 거기 있다
          → "왜 안 나가지?" 하며 계속 누르거나, 반대로 눌러서 학부모 게시판에 글이 하나 더 붙는다.
          ClassNote는 게시글 수정·삭제가 없어 되돌릴 수 없으므로, 이 날짜에 이미 나간 게 몇 건인지 먼저 말한다. */}
      {sentRowCount > 0 ? (
        <div className="border-primary/30 bg-primary-soft/40 text-text flex flex-wrap items-center gap-x-1.5 rounded-md border px-3 py-2 text-[12.5px]">
          <span className="font-bold">
            이 날짜는 이미 학부모에게 발송된 보고서가 {sentRowCount}건 있습니다
          </span>
          {/* ⚠️ 탈출구를 **실제로 화면에 있는 것**으로 적는다. 2026-08-06부터 게시된 보고서에는
              '공유 링크 재발급'이 아예 안 뜬다(게시글은 이미지라 링크를 만져도 학부모 화면이 그대로여서
              반쪽 수습을 고를 수 없게 감췄다) — 그런데 이 안내만 옛 경로를 가리키고 있었다.
              문구는 카드 안 배너(report-card.tsx)와 **같은 말**로 맞춘다(두 곳이 다르면 어느 쪽이 맞는지 모른다). */}
          <span className="text-text-dim">
            — 발송 완료된 건은 <b>그대로는 수정할 수 없습니다</b>. ClassNote는 게시글 수정이 없어 학부모가
            받은 것과 기록이 갈라지기 때문입니다. 고쳐야 하면 카드에서 <b>회수</b>로 학부모 게시글을 지우세요
            — 삭제가 끝나면 입력이 열리고 <b>ClassNote 발송</b>으로 수정본을 다시 보낼 수 있습니다.
          </span>
        </div>
      ) : null}

      {/* 다른 창/기기 동시 열림 경고(3-3) — 소프트(락 아님). 같은 학생을 양쪽에서 입력하면 마지막 저장이 이긴다. */}
      {sameDateEditors.length > 0 ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-1.5 rounded-md border px-3 py-2 text-[12.5px]">
          <span className="font-bold">다른 창/기기에서 같은 날짜를 열어 두었습니다</span>
          <span>— 같은 학생을 양쪽에서 입력하면 마지막 저장이 덮어씁니다.</span>
        </div>
      ) : null}

      {/* 작성 필터 안내(월간 발송 뷰는 목록을 안 쓰므로 제외).
          ① 조건과 어긋난 채 남아 있는 학생 = 입력 중 사라지지 않게 고정한 결과라는 사실을 밝힌다(무언 잔류 금지).
          ② 필터 결과가 0명이면 왜 비었는지 말하고 되돌아갈 문을 준다(빈 화면 막다른 길 금지). */}
      {writeFilter !== "all" && view !== "history" ? (
        staleCount > 0 ? (
          <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]">
            <span>
              <b className="text-foreground">
                {writeFilter === "unwritten" ? "작성을 마친" : "문구가 비워진"} {staleCount}명
              </b>
              이 목록에 남아 있습니다 — 입력 중 카드·행이 사라지지 않도록 유지합니다.
            </span>
            <button
              type="button"
              onClick={() => changeWriteFilter(writeFilter)}
              className="text-primary font-bold underline underline-offset-2"
            >
              목록 정리
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]">
            <span className="text-foreground font-bold">
              {writeFilter === "unwritten"
                ? "미작성 학생이 없습니다 — 이 목록은 모두 작성했습니다"
                : "작성한 학생이 아직 없습니다"}
            </span>
            <button
              type="button"
              onClick={() => changeWriteFilter("all")}
              className="text-primary font-bold underline underline-offset-2"
            >
              전체 보기
            </button>
          </div>
        ) : null
      ) : null}

      {/* 글씨 크기 — 목록·표 영역만 감싼다(상단 바는 그대로: 크기를 고르는 컨트롤 자체가 같이 커지면 어지럽다).
          ⚠️ `font-size`가 아니라 `zoom`인 이유는 font-size.ts 주석 참조(칸마다 px 글자가 박힌 조밀한 표).
          기본('작음')은 배율 1이라 **스타일 자체를 붙이지 않는다** — 손대지 않은 강사의 렌더는 완전 무변경. */}
      <div style={fontZoom === 1 ? undefined : { zoom: fontZoom }}>
      {view === "grid" ? (
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
          }}
          fields={{
            onAttendance: setAttendanceFor,
            onProgress: setProgressFor,
            onProgressMode: setProgressModeFor,
            onStudyGrade: setStudyGradeFor,
            onScore: setScoreFor,
            onMax: setMaxFor,
            onAttitude: setAttitudeValue,
            onHomework: setHomeworkValue,
            onTextbook: setTextbookFor,
            onHomeworkToday: setHomeworkTodayFor,
            onDraft: setDraftFor,
            onTrend: setTrendDraftFor,
            onNote: setNoteFor,
            onMakeup: toggleMakeupFor,
          }}
          rowActions={{
            onSendRow: sendRow,
            onAutoWrite: autoWriteRow,
            onOpenCard: openCard,
            onImportPrev: importPrevFor,
            onAttach: (student, subjectName, files) => void addAttachmentsFor(student, subjectName, files),
            onRemoveAttachment: (student, subjectName, path) =>
              void removeAttachmentFor(student, subjectName, path),
            onOpenAttachments: (student, subjectName) => void ensureAttachmentUrls(student, subjectName),
            // 발송분은 버튼을 아예 열지 않는다(서버도 막지만 화면에서 먼저 알린다).
            onRemoveMakeup: (student, subjectName) => void removeMakeupRow(student, subjectName),
            canRemoveMakeup: (studentId, subjectName) =>
              canRemoveMakeupRow(reports[studentId]?.[subjectName]?.classnoteStatus ?? null),
          }}
          bulkActions={{
            onSaveAll: saveAllVisible,
            onSendAll: sendAllVisible,
            onAutoWriteAll: autoWriteAllVisible,
            onClassNotice: openNoticeForRows,
            onBulkApply: bulkApplyValues,
            onCopyFirstRow: copyFirstRowDown,
            onBulkImportPrev: bulkImportPrev,
            onBulkAttach: (keys, files) => void bulkAttach(keys, files),
          }}
          uploadingAttKey={uploadingAttKey}
          order={orderClass && !readonlyView ? { classId: orderClass.id, onSave: saveOrderForClass } : undefined}
          classFilter={activeClassFilter}
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
                  ? `${orderClass.name} 반 서술 저장 — 이후 자동작성부터 학생별 멘트에 반영됩니다`
                  : `${orderClass.name} 반 서술을 지웠습니다`,
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
      /* 열 = **학생 · 보고서 · 학부모 미리보기**(2026-08-05 통합).
         진도·테스트를 따로 세우지 않는다 — 원장: *"이걸 하나의 섹션으로 합쳐버리면 안되나? 공간낭비
         최소화할 수 있게? 굳이 따로 할 필요 있나?"* 그 열은 콘텐츠보다 훨씬 길어 아래가 통째로 비었고,
         보고서 카드 맨 위 요약이 **같은 값을 두 번** 보여주고 있었다. 이제 보고서 카드 안에서
         `@container` 폭에 따라 1 → 2 → 3열(진도·테스트 / 그 밖의 입력 / 문장·발송)로 펼쳐진다.
         미리보기 열(≥1680px)은 **544px 고정** — 학부모가 받는 실제 이미지 폭(512px + 패딩)이라 늘리거나
         줄이면 "실제 크기"가 거짓이 된다. 그보다 좁으면 미리보기는 아래 전체폭 행으로 내려간다. */
      /* 🔴 **미리보기는 항상 우측**(원장 2026-08-05: 좁은 창에서 아래로 밀리는 게 싫다 — "아래쪽보다
         우측에 있어서 스크롤처리하고싶네"). 그래서 `lg` 이상에선 3열을 **고정 폭으로 유지**하고, 창이
         좁으면 열을 접는 대신 **가로로 스크롤**된다(`lg:min-w`). 세로로 접히는 건 진짜 작은 화면(<lg)뿐.
         ⚠️ 스크롤 래퍼를 새로 만들면 안 된다 — 셸의 `<main>`이 이미 `overflow-auto` 스크롤 컨테이너라
            여기에 `overflow-x-auto`를 하나 더 두면 **학생목록의 `lg:sticky`가 그 래퍼 기준이 되어 깨진다**
            (높이가 콘텐츠만큼이라 붙을 자리가 없다). min-w만 주면 main이 알아서 가로 스크롤한다.
         최소폭 = 학생 240 + 보고서 590(카드 좌우 패딩 24 + 내부 2열 분기 560) + 미리보기 544 + gap 32 + 여유. */
      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:min-w-[1420px] lg:flex-1 lg:grid-cols-[240px_minmax(590px,1fr)_544px] lg:items-stretch">
        <StudentList
          students={visible}
          bulkPresent={bulkPresentProps}
          selId={effectiveId}
          onSelect={setSelId}
          reportCellById={reportCellById}
          sendMarkById={sendMarkById}
          classOrder={classTags.filter((t) => t !== "전체")}
          testConfig={testCfg}
          emptyLabel={emptyByWriteFilter}
        />

        {selected ? (
          <>
            {/* 가운데(보고서 작성) — 넘치면 **이 열만** 스크롤. 좁은 화면(<lg)에선 열이 세로로 쌓이므로
                높이를 묶지 않는다(그땐 페이지가 통째로 스크롤되는 게 자연스럽다). */}
            <div className="scrollbar-thin flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <header className="flex items-center gap-1.5">
                <EyIcon name="report" size={14} className="text-primary" />
                <h2 className="text-foreground text-sm font-bold">보고서</h2>
                <button
                  type="button"
                  onClick={() => openNoticeForStudent(selected.id)}
                  title="이 학생 학부모에게 공지(진도·평가 없이 안내글만) 발송"
                  className="border-line text-text-dim hover:bg-bg-soft ml-auto rounded-lg border px-2 py-0.5 text-[11px] font-bold"
                >
                  학부모 공지
                </button>
              </header>
              <ReportCard
                key={selected.id}
                readonlyView={readonlyView}
                student={selected}
                reports={reports[selected.id] ?? {}}
                attitudes={ATTITUDE}
                onAttitude={setAttitude}
                onHomework={setHomework}
                onTextbook={setTextbook}
                onHomeworkToday={setHomeworkToday}
                onMakeup={toggleMakeup}
                onRemoveMakeup={(subjectName) => void removeMakeupRow(selected, subjectName)}
                canRemoveMakeup={(subjectName) =>
                  canRemoveMakeupRow(reports[selected.id]?.[subjectName]?.classnoteStatus ?? null)
                }
                onSubjectDraft={setSubjectDraft}
                onSubjectTrend={setSubjectTrend}
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
                    <ProgressCard
                      embedded
                      student={selected}
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
                    <TestCard
                      embedded
                      student={selected}
                      // 선택된 행의 점수를 보여준다 — 쓰기(setScore)도 그 행에 간다(row-fields.ts).
                      tests={resolveRowFields(selected, previewSubject).tests}
                      onScore={setScore}
                      allowMax={allowTeacherTestMax}
                      onMax={setMax}
                      dailyEnabled={showDailyTest}
                      checkEnabled={showCheckTest}
                    />
                  </>
                }
              />
            </div>

            {/* 4열째 — 학부모가 받는 화면 그대로(실시간). ≥1680px에서만 옆에 서고, 그보다 좁으면
                아래 전체폭 행으로 내려간다(나란히 둘 자리가 없을 때 억지로 끼우면 양쪽 다 찌그러진다). */}
            {previewCtx && previewSubject ? (
              <div className="scrollbar-thin lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <ReportPreview
                  ctx={previewCtx}
                  student={selected}
                  subject={previewSubject}
                  draft={previewReport?.draft ?? ""}
                  trendDraft={previewReport?.trendDraft}
                  attachments={previewReport?.attachments ?? []}
                  attachmentUrls={attUrls}
                  trendRows={trendRows}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm lg:col-span-2">
            학생을 선택하세요
          </div>
        )}
      </div>
      )}
      </div>

      {/* '이전값 일괄 가져오기' 뒤 멘트 확인 — 나머지 칸은 이미 채워졌고, 여기 확인해야 학부모 문구까지 채운다.
          닫힘(취소)은 계획을 버리기만 한다(다른 칸 되돌리지 않음 — 그 칸들은 오늘 값 입력이라 문제 없음). */}
      <ConfirmDialog
        open={!!prevCommentPlan}
        title="멘트도 일괄 가져오시겠습니까?"
        message={`학부모 문구가 비어 있는 ${prevCommentPlan?.length ?? 0}개 행에 직전 회차에 보낸 멘트를 그대로 채웁니다. 오늘 진도·점수와 다를 수 있으니 발송 전에 확인·수정하세요.`}
        confirmLabel="멘트도 가져오기"
        cancelLabel="아니요"
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
          absenceOptions={makeupAsk.absences}
          absenceLoading={makeupAsk.absencesLoading}
          makeupDate={activeDate}
          onConfirm={resolveMakeupAsk}
          onCancel={() => setMakeupAsk(null)}
        />
      ) : null}
    </div>
  );
}
