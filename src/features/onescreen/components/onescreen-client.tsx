"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { kstToday } from "@/lib/date-kst";
import { usePrintWindow } from "@/components/workspace/print-window";
import { ATTITUDE, CLASS_TAGS, HOMEWORK, TODAY } from "../data";
import type { OneScreenView } from "../view";
import { buildSubjectReport, studentStatus } from "../report";
import { buildReportCommentInput } from "../report-comment";
import {
  buildMakeupStudent,
  loadMakeupHistory,
  generateReportComment,
  reissueShareLink,
  revokeShareLink,
  saveAndQueueClassnote,
  saveLessonReport,
  saveOnescreenSession,
  setMyNoticeMode,
} from "../server/actions";
import { MakeupAdder } from "./makeup-adder";
import {
  issueReportAttachmentUploadTicket,
  registerReportAttachment,
  removeReportAttachment,
  signReportAttachmentUrls,
} from "../server/attachment-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import type { AttendanceMark, CellState, OneScreenStudent } from "../types";
import { OneScreenTopBar } from "./top-bar";
import { StudentList } from "./student-list";
import type { TodayClass } from "../server/roster";
import { ProgressCard } from "./progress-card";
import { TestCard } from "./test-card";
import { ReportCard, type SubjectReport } from "./report-card";
import { OneScreenGrid } from "./onescreen-grid";
import { StatusBoard } from "./status-board";
import { HistoryBoard } from "./history-board";
import { NoticeComposer } from "./notice-composer";
import {
  buildGridRows,
  rowKey,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  planBulkPrevFill,
  planPrevComments,
  rowInClass,
  summarizeSendGaps,
  type BulkPatch,
  type PrevCommentPlan,
  type RowAction,
} from "../grid";
import {
  getClassNarratives,
  getServerClassNarratives,
  setClassNarrative,
  subscribeClassNarratives,
} from "../class-narrative-store";
import { applyStudentOrder } from "../student-order";
import { saveStudentOrder } from "../server/order-actions";
import { useClassnoteStatusSync } from "./use-classnote-status-sync";
import { mergeClassnoteStatuses, pendingSendStudentIds, type ClassnoteStatusRow } from "../classnote-status";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { BasicAttendance } from "./attendance-pills";
import { useEditPresence, useEditingOthers } from "@/features/presence/edit-presence";
import { dedupeEditors } from "@/features/presence/presence-state";

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

/** 오늘 시험·테스트 합본("일일 18/20, 확인 19/20") — exam_info 규격(추세 조립·prev-score 파싱 공용).
 * 미입력·**비활성 테스트(학원설정 off)** 항목은 생략 — 세션에서 복원된 옛 점수가 저장에 새는 것 차단. */
function buildExamInfo(st: OneScreenStudent, dailyOn: boolean, checkOn: boolean): string {
  return [
    dailyOn && st.tests.daily.score != null ? `일일 ${st.tests.daily.score}/${st.tests.daily.max}` : null,
    checkOn && st.tests.check.score != null ? `확인 ${st.tests.check.score}/${st.tests.check.max}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

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
  sendWindowLabel = null,
  showAttachments = true,
  canEditAttendance = true,
  presenceScope,
  initialView = "card",
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
  sendWindowLabel?: string | null; // 발송 허용 시간창 "HH:MM~HH:MM"(무제한=null) — 상단 강사 참고 안내
  showAttachments?: boolean; // 사진/파일 첨부 표시(학원 설정) — off면 첨부해도 안 실린다는 경고를 카드에 표시
  canEditAttendance?: boolean; // 출결 쓰기 권한 — false면 pill을 표시 전용으로(서버 거절 전에 화면에서 알림)
  presenceScope?: string; // `onescreen:{teacherId}:{date}` — 다른 창/기기 동시 열림 경고(서버가 teacherId 파생)
  initialView?: OneScreenView; // URL(?view=)에서 온 초기 뷰 — 날짜 이동(재마운트) 후에도 보던 뷰 유지
}) {
  const router = useRouter();
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [noticeMode, setNoticeMode] = useState<"A" | "B" | null>(initialNoticeMode);
  // 보강 학생 중 '이전 진도'를 이미 불러온 학생 id — 버튼 숨김·재요청 방지.
  const [prevLoaded, setPrevLoaded] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string>(initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>("전체");
  // 대상 날짜(빈값=오늘). 날짜 이동 = searchParam 네비 → 서버가 그 날짜 로스터 재조회 + key로 클라 재초기화.
  const activeDate = date || kstToday();
  const todayYmd = kstToday();
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
  const [view, setView] = useState<OneScreenView>(initialView);
  // 공지 컴포저 진입 시 초기 선택 학생(카드=1명, 표=선택/표시). null=진입 안 함.
  const [noticeSeed, setNoticeSeed] = useState<string[] | null>(null);
  // '이전값 일괄 가져오기' 뒤 멘트 확인 대기 계획(null=다이얼로그 닫힘) — 확인해야만 학부모 문구를 채운다.
  const [prevCommentPlan, setPrevCommentPlan] = useState<PrevCommentPlan[] | null>(null);
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial));
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(카드 버튼 로딩)
  const [genKey, setGenKey] = useState<string | null>(null); // 표 행별 자동작성 로딩 키(studentId::과목)
  const [bulkGen, setBulkGen] = useState(false); // 표 일괄 자동작성 진행중
  const [bulkBusy, setBulkBusy] = useState<"save" | "send" | null>(null); // 일괄 저장/발송 진행중 — 재진입·행발송 잠금(#9/#10)
  const [attUrls, setAttUrls] = useState<Record<string, string>>({}); // 첨부 path→signed 썸네일 URL(P2b)
  const [attPending, setAttPending] = useState<Set<string>>(new Set()); // 출결 저장 중 (학생::반) — pill 잠금(2-2)
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
        s.subjects.map((su) => [
          su.subjectKey || su.name,
          {
            today: su.today,
            draft: r?.[su.name]?.draft ?? "",
            trendDraft: r?.[su.name]?.trendDraft ?? "",
            textbook: su.textbook ?? "",
            makeup: su.makeup ?? false,
            homeworkToday: su.homeworkToday ?? "",
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
  const visible =
    activeClassFilter == null
      ? students
      : students
          .filter((s) => (s.tags ?? [s.tag]).includes(activeClassFilter))
          .map((s) => ({ ...s, className: activeClassFilter, tag: activeClassFilter }));
  // 순서변경(3-2)은 단일 반 필터에서만 — 저장 키가 (강사×반)이라 "전체"에선 반이 특정되지 않는다.
  // ⚠️ 동명 반(과목만 다른 같은 이름, 스키마 허용) 가드: 필터는 이름 기반이라 두 반 학생이 섞여 보이는데
  //    첫 반 id로 저장하면 남의 반 학생이 섞인다(리뷰 확정) → 이름 매칭이 유일할 때만 순서 기능 노출.
  const matchingClasses =
    classFilter !== "전체" ? todayClasses.filter((c) => c.name === classFilter) : [];
  const orderClass = matchingClasses.length === 1 ? matchingClasses[0] : undefined;
  const effectiveId = visible.some((s) => s.id === selId) ? selId : (visible[0]?.id ?? "");
  const selected = visible.find((s) => s.id === effectiveId) ?? null;

  // 보고서 셀(과목별 발송 반영) + "오늘 마감" 카운트.
  // 테스트 사용 여부(showDailyTest/showCheckTest)를 넘겨 비활성 테스트가 마감 카운트를 0에 고정하지 않게(#25).
  const testCfg = { dailyEnabled: showDailyTest, checkEnabled: showCheckTest };
  const reportCellById: Record<string, CellState> = {};
  for (const s of students) reportCellById[s.id] = reportCell(reports[s.id], s.subjects.length);
  const doneCount = students.filter((s) => {
    const st = studentStatus(s, testCfg);
    return st.prog === "ok" && st.test === "ok" && reportCellById[s.id] === "ok";
  }).length;

  // 허브 통계(B2) — 오늘 마감 진행 현황.
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
      mergeClassnoteStatuses(prev, rows, (studentId, subjectKey) =>
        studentsRef.current
          .find((s) => s.id === studentId)
          ?.subjects.find((su) => (su.subjectKey || su.name) === subjectKey)?.name,
      ),
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
  function setStudyGradeFor(studentId: string, grade: string) {
    // 진도 학년 변경(선행/후행) → 그 학년 차시로 다시 고르도록 오늘 진도 초기화. ⚠️ **math(커리큘럼 피커) 과목만** —
    // studyGrade는 math 진도선택창에서만 쓰이는데 전 과목을 지우면 다과목 학생의 영어 등 자유텍스트 진도가
    // 소리 없이 삭제·영속된다(#6 확정). isMathSubject와 동일 규칙(미지정=math).
    patch(studentId, (s) => ({
      ...s,
      studyGrade: grade,
      subjects: s.subjects.map((su) =>
        (su.subjectKey ?? "math") === "math" ? { ...su, today: "" } : su,
      ),
    }));
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
  // 보강(수업외) 학생 추가 — 서버에서 OneScreenStudent 조립(담당 과목·교재 기본값). 세션 저장은 스킵(반 없음).
  async function addMakeupStudent(studentId: string) {
    if (students.some((s) => s.id === studentId)) {
      setSelId(studentId);
      toast.message("이미 목록에 있는 학생입니다");
      return;
    }
    const res = await buildMakeupStudent(studentId, date || undefined); // 조회 중인 날짜 전달(과거 백필 중복게시 방지)
    if (!res.ok || !res.student) {
      toast.error(res.error ?? "학생을 추가하지 못했습니다");
      return;
    }
    const st = res.student;
    setStudents((prev) => [...prev, st]);
    setReports((prev) => ({ ...prev, [st.id]: initReports([st])[st.id] ?? {} }));
    setSelId(st.id);
    toast.success(`${st.name} (보강) 추가됨`);
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
  function setScoreFor(studentId: string, which: "daily" | "check", v: number | null) {
    patch(studentId, (s) => ({ ...s, tests: { ...s.tests, [which]: { ...s.tests[which], score: v } } }));
  }
  // 테스트 만점(/N) 변경 — 학원설정 allowTeacherTestMax on일 때만 UI 노출. 점수가 새 만점 초과면 함께 클램프.
  function setMaxFor(studentId: string, which: "daily" | "check", v: number) {
    const max = Math.max(1, Math.min(100, Math.round(v) || 1));
    patch(studentId, (s) => {
      const cur = s.tests[which];
      const score = cur.score != null ? Math.min(cur.score, max) : cur.score;
      return { ...s, tests: { ...s.tests, [which]: { ...cur, max, score } } };
    });
  }
  // ── 출결 인라인 입력(2-2) — 출석부와 같은 기록(setAttendanceCell 재사용). 행(반) 단위 raw 보존 ──
  const markOf = (s: string): AttendanceMark =>
    s === "late" ? "지각" : s === "absent" || s === "early_leave" ? "결석" : "출석";
  function applyAttendanceLocal(studentId: string, classId: string, raw: string | null, mark?: AttendanceMark) {
    patch(studentId, (s) => ({
      ...s,
      attendance: mark ?? (raw ? markOf(raw) : s.attendance),
      subjects: s.subjects.map((su) => (su.classId === classId ? { ...su, attendanceRaw: raw } : su)),
    }));
  }
  // 실패 롤백 — 행 raw는 되돌리되, 배지(학생단위)는 **내 낙관값이 아직 살아있을 때만** 복원(compare-and-swap).
  // 그 사이 다른 반 pill 갱신이 배지를 바꿨으면 그걸 보존한다(#17: 앞 요청 롤백이 뒤 성공 배지를 지우던 문제).
  function rollbackAttendance(
    studentId: string,
    classId: string,
    prevRaw: string | null,
    myMark: AttendanceMark,
    prevMark: AttendanceMark,
  ) {
    patch(studentId, (s) => ({
      ...s,
      attendance: s.attendance === myMark ? prevMark : s.attendance,
      subjects: s.subjects.map((su) => (su.classId === classId ? { ...su, attendanceRaw: prevRaw } : su)),
    }));
  }
  // 재클릭 no-op(삭제는 출석부에서만) + (학생×반) in-flight 잠금(연속 클릭 응답 역전 방지) + 실패 롤백.
  // 낙관 갱신으로 pill 즉시 반응(반응속도 1순위) — 서버 검증(담당 반·수강생)은 setAttendanceCell이 강제.
  async function setAttendanceFor(studentId: string, classId: string, status: BasicAttendance) {
    const key = `${studentId}::${classId}`;
    if (attPending.has(key)) return;
    const stu = studentsRef.current.find((s) => s.id === studentId);
    const prevRaw = stu?.subjects.find((su) => su.classId === classId)?.attendanceRaw ?? null;
    const prevMark = stu?.attendance ?? "출석";
    if (prevRaw === status) return;
    const myMark = markOf(status);
    setAttPending((p) => new Set(p).add(key));
    applyAttendanceLocal(studentId, classId, status);
    try {
      const res = await setAttendanceCell({ studentId, classId, sessionDate: activeDate, status });
      if ("error" in res) {
        rollbackAttendance(studentId, classId, prevRaw, myMark, prevMark);
        toast.error(res.error);
      }
    } catch {
      rollbackAttendance(studentId, classId, prevRaw, myMark, prevMark);
      toast.error("출결 저장에 실패했습니다 — 네트워크를 확인해 주세요");
    } finally {
      setAttPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }
  // 표=SET(선택값), 카드=TOGGLE(같은 값 재클릭 시 해제) — 카드 wrapper가 토글을 계산해 SET 호출.
  function setAttitudeValue(studentId: string, a: string | null) {
    patch(studentId, (s) => ({ ...s, attitude: a }));
  }
  function setHomeworkValue(studentId: string, h: string) {
    patch(studentId, (s) => ({ ...s, homework: h }));
  }
  // 특이사항(강사 메모) — AI 멘트 입력(공지 모드 A/B). 학생별. 자동저장(patch→queueSave)에 실림.
  function setNoteFor(studentId: string, text: string) {
    patch(studentId, (s) => ({ ...s, note: text }));
  }
  function setNote(text: string) {
    if (!selected) return;
    setNoteFor(selected.id, text);
  }
  function setProgress(subjectIndex: number, today: string) {
    if (!selected) return;
    setProgressFor(selected.id, subjectIndex, today);
  }
  function setStudyGrade(grade: string) {
    if (!selected) return;
    setStudyGradeFor(selected.id, grade);
  }
  function setScore(which: "daily" | "check", v: number | null) {
    if (!selected) return;
    setScoreFor(selected.id, which, v);
  }
  function setMax(which: "daily" | "check", v: number) {
    if (!selected) return;
    setMaxFor(selected.id, which, v);
  }
  function setAttitude(a: string) {
    if (!selected) return;
    setAttitudeValue(selected.id, selected.attitude === a ? null : a);
  }
  function setHomework(h: string) {
    if (!selected) return;
    setHomeworkValue(selected.id, selected.homework === h ? "" : h);
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
  // AI 학부모 멘트 + 학습 추세 생성 코어(카드·표 공용) — 멘트 실패 시 결정적 템플릿 폴백,
  // 추세는 표본 부족/실패면 조용히 생략(기존 값 유지). 둘을 학생별 병렬(Promise.all)로 생성해 지연 최소화.
  async function generateDraftFor(student: OneScreenStudent, subjectName: string) {
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    if (idx < 0) return;
    const su = student.subjects[idx];
    const subjectKey = su?.subjectKey || su?.name || undefined;
    // 반 공통 서술(G6) — 이 행의 반 서술을 생성 재료로 동봉(없으면 기존 동작). 카드·표·일괄 공용 경로라 전부 커버.
    // ⚠️ 키 = classId(이름 아님) — 동명 반(수학·영어 같은 이름, 스키마 허용)에서 이름 키면 남의 반 수업
    // 맥락이 교차 주입된다(리뷰 확정 major, 순서 기능 동명 가드와 같은 원인). classId null(모호 행·보강)=서술 없음.
    const classContext = (su?.classId && classNarratives[su.classId]) || "";
    try {
      // 통합 1회 호출 — 멘트 + 추세를 한 번에 생성(비용·지연↓).
      const res = await generateReportComment({ ...buildReportCommentInput(student, idx), classContext }, {
        studentId: student.id,
        subject: subjectKey,
        todayExamInfo: buildExamInfo(student, showDailyTest, showCheckTest),
        todayHomework: student.homework,
        date: date || undefined, // 보는 날짜 — 과거 날짜면 추세를 그 날짜 기준으로(이후 채점 이력 있으면 추세 생략)
      });
      const text = res.ok && res.comment ? res.comment : buildSubjectReport(student, idx);
      if (!res.ok) toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        // 추세는 생성 성공 시에만 갱신(표본 부족·실패면 기존 초안·수동 입력 보존).
        ...(res.ok && res.trend ? { trendDraft: res.trend } : {}),
      }));
    } catch {
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: buildSubjectReport(student, idx) }));
      toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
    }
  }
  async function autoWriteSubject(subjectName: string) {
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
    const key = `${student.id}::${subjectName}`;
    setGenKey(key);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenKey((cur) => (cur === key ? null : cur));
    }
  }
  // 표 일괄 작업 대상 — keys(체크된 행) 있으면 그 교집합, 없으면 표시 행 전체. 진도 필수 공통.
  // ⚠️ action별 판정(2-3, isRowActionable): save=결석 포함(기록 보존), send/autowrite=결석 제외(발송·AI 무의미).
  function selectRows(action: RowAction, keys?: string[]) {
    const all = buildGridRows(visible)
      .filter((r) => rowInClass(r.subject, activeClassFilter)) // 특정 반이면 그 반 행만(타 반 혼입 차단)
      .filter((r) => isRowActionable(r.subject, action));
    if (!keys || keys.length === 0) return all;
    const set = new Set(keys);
    return all.filter((r) => set.has(r.key));
  }
  async function autoWriteAllVisible(keys?: string[]) {
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
  function bulkApplyValues(keys: string[], patchFields: BulkPatch, onlyEmpty: boolean) {
    const all = buildGridRows(visible).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const plan = planBulkApply(
      rows.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        attitude: r.student.attitude,
        homework: r.student.homework,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
      })),
      patchFields,
      onlyEmpty,
    );
    if (plan.length === 0) {
      toast.message("적용할 칸이 없습니다");
      return;
    }
    for (const p of plan) {
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.set.attitude);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.set.homework);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
    }
    toast.success(`${plan.length}행에 일괄 적용했습니다`);
  }
  // 이전 회차 가져오기(1-3) — 그 행의 **빈 칸만** 채움(진도·태도·과제·오늘 과제).
  // ⚠️ 특이사항은 채우지 않음 — prevReport.note는 학부모 발송 본문(notes)이라 특이사항이 아니다.
  function importPrevFor(student: OneScreenStudent, subjectName: string) {
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
      homeworks: HOMEWORK,
    });
    const count = Object.keys(fill).length;
    if (!count) {
      toast.message("가져올 빈 칸이 없습니다 — 이미 입력됐거나 이전 회차 값이 없습니다");
      return;
    }
    if (fill.today !== undefined) setProgressFor(student.id, idx, fill.today);
    if (fill.attitude !== undefined) setAttitudeValue(student.id, fill.attitude);
    if (fill.homework !== undefined) setHomeworkValue(student.id, fill.homework);
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
          },
        ];
      }),
      ATTITUDE,
      HOMEWORK,
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
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.set.attitude);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.set.homework);
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
    for (const p of plan) setDraftFor(p.studentId, p.subjectName, p.comment);
    toast.success(`${plan.length}행의 멘트를 직전 회차 문구로 가져왔습니다 — 발송 전에 오늘 내용과 맞는지 확인하세요`);
  }
  // 학생 순서 저장(3-2) — (강사×반) 영구 저장 + 성공 시 클라 state에도 즉시 반영(다음 로드는 roster가 적용).
  async function saveOrderForClass(classId: string, studentIds: string[]): Promise<boolean> {
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
    setNoticeSeed([studentId]);
    setView("notice");
  }
  function openNoticeForRows(keys?: string[]) {
    const ids =
      keys && keys.length
        ? [...new Set(keys.map((k) => k.split("::")[0]!))]
        : visible.map((s) => s.id);
    setNoticeSeed(ids);
    setView("notice");
  }
  // 저장 입력(보고서 필드)을 (학생,과목)별로 조립 — 카드/표 공용. 초안 없으면 자동 작성분 사용.
  function buildSaveInputFor(student: OneScreenStudent, subjectName: string) {
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    // ⚠️ 최신 초안은 ref에서(일괄 루프 중 사용자 편집·앞 행 patch 반영) — closure `reports`는 클릭 시점 스냅샷이라 유실 위험(#10).
    const existing = reportsRef.current[student.id]?.[subjectName];
    const draft = existing?.draft.trim() ? existing.draft : buildSubjectReport(student, idx);
    const trendNote = existing?.trendDraft?.trim() || undefined; // 추세 초안 있으면 함께 저장(없으면 미저장)
    const examInfo = buildExamInfo(student, showDailyTest, showCheckTest);
    // 학부모 보고서 일일/확인테스트 분리 표시용("N문제 중 M개"). exam_info(합본)는 roster prev-score 파싱용 별도 보존.
    // 비활성 테스트(학원설정 off)는 세션에서 복원된 옛 점수가 남아 있어도 저장·발송하지 않는다(입력칸도 숨김 → 새 보고서엔 안 나감).
    const dailyTest =
      showDailyTest && student.tests.daily.score != null ? `${student.tests.daily.max}문제 중 ${student.tests.daily.score}개` : "";
    const checkTest =
      showCheckTest && student.tests.check.score != null ? `${student.tests.check.max}문제 중 ${student.tests.check.score}개` : "";
    return {
      draft,
      input: {
        studentId: student.id,
        reportDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — report_date가 곧 카드 표시일·ClassNote 게시일
        textbook: su?.textbook || "",
        makeup: su?.makeup ?? false,
        homeworkToday: su?.homeworkToday || "",
        progress: su ? `${su.name} ${su.today}`.trim() : "",
        examInfo,
        homeworkScore: student.homework,
        dailyTest,
        checkTest,
        attitude: student.attitude ?? "",
        // 모드 B에서 1문단만 비우면 초안이 "\n\n2문단"으로 유지된다(편집 중 글자가 위 칸으로 튀는 것 방지,
        // comment-paragraphs.ts 불변식). 학부모에게 나가는 값은 여기서 다듬는다 — 앞 빈 줄 금지.
        notes: draft.trim(),
        trendNote, // 학습 추세(종합분석) — 4a
        subject: su?.subjectKey || su?.name || undefined, // (student,date,subject) 과목별 1행 dedup 키
        outOfClass: student.isMakeup ?? false, // 보강(수업외) 학생 = 담당반 검사 우회(같은 학원이면 허용)
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
    const built = buildSaveInputFor(student, subjectName);
    const res = await saveLessonReport(built.input);
    if (res.ok) {
      // shareToken 보존 → report-card가 학부모 공개 링크(/r/[token])를 노출·복사. 기존 첨부·상태는 유지(merge).
      // draft는 사용자가 저장 중(await) 사이 더 고쳤으면 그 편집을 보존(built는 조립 시점 값 — 클로버 방지, #10).
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: r.draft?.trim() && r.draft !== built.draft ? r.draft : built.draft,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
      }));
      confirmProgressOnSave(student.id); // 보고서 저장=진도 확정(표 모드엔 확정 버튼이 없어 지표 0 고정되던 문제, #13)
    }
    return res;
  }
  async function queueOne(student: OneScreenStudent, subjectName: string) {
    const built = buildSaveInputFor(student, subjectName);
    const res = await saveAndQueueClassnote(built.input);
    if (res.ok) {
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: r.draft?.trim() && r.draft !== built.draft ? r.draft : built.draft,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
        classnoteStatus: res.status,
      }));
      confirmProgressOnSave(student.id);
    }
    return res;
  }

  async function sendSubject(subjectName: string, channel: string) {
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
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
      return;
    }
    const res = await queueOne(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? "ClassNote 발송 큐 적재에 실패했습니다");
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
    if (bulkGen || bulkBusy) {
      toast.message("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
      return;
    }
    const res = await queueOne(student, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    if (res.status === "name_conflict") {
      toast.error(`${student.name} — 동명이인이 있어 발송을 막았습니다(학생 관리에서 ClassNote 이름 지정)`);
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
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    const rows = selectRows("save", keys);
    const skipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    if (rows.length === 0) {
      toast.message("저장할 행이 없습니다 — 오늘 진도를 입력하세요");
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
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    const rows = selectRows("send", keys);
    const preSkipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    if (rows.length === 0) {
      toast.message("발송할 행이 없습니다 — 오늘 진도를 입력하세요 (결석 학생은 발송 제외)");
      return;
    }
    // 발송 전 누락 안내(2-4) — 차단 아님("누락=생략" 철학 유지). 누락은 고유 학생 수 기준.
    // ⚠️ 결석 제외는 **행(과목) 단위 건수** — 다과목 학생은 결석 반 과목만 빠지고 다른 과목은 발송되므로
    //    "N명 제외"로 쓰면 오안내(리뷰 확정). 발송 단위=행(lesson_reports 1건)이라 "건"이 정확.
    const absentRows = selectRows("save", keys).filter((r) => r.subject.attendanceRaw === "absent").length;
    const gaps = summarizeSendGaps(rows, { dailyEnabled: showDailyTest, checkEnabled: showCheckTest });
    const gapLine =
      gaps.missingAttitude || gaps.missingTest
        ? `\n태도 미입력 ${gaps.missingAttitude}명 · 테스트 미입력 ${gaps.missingTest}명 — 미입력 항목은 보고서에서 생략됩니다`
        : "";
    const absentLine = absentRows ? `\n결석 행 ${absentRows}건은 발송에서 제외됩니다` : "";
    if (
      !window.confirm(
        `${rows.length}건을 ClassNote로 일괄 발송할까요? (동명이인·취소·오래된 건은 자동 제외)${gapLine}${absentLine}`,
      )
    )
      return;
    setBulkBusy("send");
    let queued = 0;
    let blocked = 0;
    let skipped = 0;
    let subjectOff = 0; // 발송 대상 과목 아님(저장만) — '발송 대기'로 뭉뚱그리지 않고 명시(#2 확정)
    let absentSkip = 0; // 서버 결석 게이트에 걸린 행(클라 사전 필터의 사각 — 반 모호 행 등)
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
        else if (res.status === "name_conflict" || res.status === "revoked") blocked++;
        else if (res.status === "absent") absentSkip++; // 서버 결석 게이트(클라 사전 필터를 지난 반 모호 행 등)
        else skipped++; // success/processing/too_old
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      (dry ? `저장 ${dry}건(dry-run·발송 안 함) · ` : "") +
        (windowHint ? `발송 예약 ${queued}건(${windowHint}에 자동 발송)` : `발송 대기 ${queued}건`) +
        (subjectOff ? ` · 과목 제외 ${subjectOff}건(발송 대상 과목 아님)` : "") +
        (absentSkip ? ` · 결석 제외 ${absentSkip}건` : "") +
        (blocked ? ` · 차단 ${blocked}건(동명이인/취소)` : "") +
        (skipped ? ` · 제외 ${skipped}건` : "") +
        (preSkipped ? ` · 대상 제외 ${preSkipped}건(진도 미입력·결석)` : "") +
        (fail ? ` · 실패 ${fail}건` : ""),
    );
  }

  // 공유링크 취소(revoke) — 학부모 열람 즉시 차단. 대상은 그 과목의 현재 shareToken.
  async function revokeShare(subjectName: string) {
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
      classnoteStatus: undefined,
    }));
    toast.success(`${subjectName} 공유 링크를 재발급했습니다 — 새 링크를 다시 전달하세요`);
  }

  // ── 학생 사진 첨부(P2b) — 저장된 보고서에만(서버 강제). subject는 DB 저장키(subjectKey)로 넘긴다. ──
  // ⚠️ 첨부 핸들러는 **(학생, 과목) 파라미터**가 원형이고 카드는 selected를 감싸 부른다(표=행별 직접 호출) —
  //    진도·점수 핸들러와 같은 "로직 단일 소스" 규약. 표 첨부(클립·드롭·일괄)가 이 경로를 그대로 쓴다.
  const subjectKeyFor = (student: OneScreenStudent, subjectName: string): string | undefined => {
    const su = student.subjects.find((s) => s.name === subjectName);
    return su?.subjectKey || su?.name || undefined;
  };

  // 선택 학생 과목별 첨부 path 시그니처 — 경로 변경 시에만 썸네일 URL 재요청(draft 편집엔 재요청 안 함).
  const attTargets = selected
    ? selected.subjects
        .map((su) => ({
          subject: su.subjectKey || su.name || undefined,
          paths: (reports[selected.id]?.[su.name]?.attachments ?? []).map((a) => a.path),
        }))
        .filter((t) => t.paths.length > 0)
    : [];
  const attSig = attTargets.map((t) => `${t.subject ?? ""}:${t.paths.join(",")}`).join("|");
  useEffect(() => {
    // attTargets 없으면 재요청 안 함(기존 map은 path 키라 stale해도 오표시 없음 — 신규 서명 시 전체 교체).
    if (!selected || attTargets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const merged: Record<string, string> = {};
      for (const t of attTargets) {
        const res = await signReportAttachmentUrls({ studentId: selected.id, subject: t.subject, reportDate: date || undefined });
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
        patchReport(studentId, subjectName, (r) => ({
          ...r,
          draft: built.draft,
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
          classnoteStatus: undefined,
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
    const studentId = student.id;
    const res = await removeReportAttachment({
      studentId,
      subject: subjectKeyFor(student, subjectName),
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
      classnoteStatus: undefined,
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
      reportDate: date || undefined,
    });
    if (res.urls) setAttUrls((prev) => ({ ...prev, ...res.urls }));
  }

  /**
   * 선택 행 일괄 첨부 — 같은 사진/파일(시험지·판서)을 여러 학생 행에 한 번에.
   * 행마다 **순차** 처리(register가 read-modify-write라 병렬이면 서로 덮어쓴다). 게이트·저장보장은 행 단위 동일.
   */
  async function bulkAttach(keys: string[], files: File[]) {
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
    <div className="space-y-4">
      <OneScreenTopBar
        today={today}
        date={activeDate}
        todayYmd={todayYmd}
        onDateChange={goToDate}
        classTags={classTags}
        classFilter={classFilter}
        onFilter={setClassFilter}
        doneCount={doneCount}
        total={students.length}
        view={view}
        onView={setView}
        stats={hubStats}
        todayClasses={todayClasses}
        noticeMode={noticeMode}
        academyNoticeMode={academyNoticeMode}
        onNoticeMode={changeNoticeMode}
        makeupAdder={<MakeupAdder onAdd={addMakeupStudent} />}
      />

      {/* 발송 시간창 참고 안내 — 원장이 학원설정(보고서)에 시간대를 정한 경우만 표시(무제한=미표시).
          실제 지연은 워커 게이트·발송 시점 토스트가 담당 — 이 줄은 정책 인지용 상시 안내다. */}
      {sendWindowLabel ? (
        <div className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-[12.5px]">
          {/* "수업 보고서" 한정 표기 — 반 공지는 시간창 미적용(G1 확정)이라 ClassNote 전체로 말하면 과약속. */}
          <span className="text-foreground font-bold">수업 보고서 발송 시간대 {sendWindowLabel}</span>
          <span> — 이 시간 외에 발송하면 예약돼 시간대가 열릴 때 자동 발송됩니다.</span>
        </div>
      ) : null}

      {/* 다른 창/기기 동시 열림 경고(3-3) — 소프트(락 아님). 같은 학생을 양쪽에서 입력하면 마지막 저장이 이긴다. */}
      {sameDateEditors.length > 0 ? (
        <div className="border-amber/40 bg-amber/5 text-amber flex flex-wrap items-center gap-x-1.5 rounded-md border px-3 py-2 text-[12.5px]">
          <span className="font-bold">다른 창/기기에서 같은 날짜를 열어 두었습니다</span>
          <span>— 같은 학생을 양쪽에서 입력하면 마지막 저장이 덮어씁니다.</span>
        </div>
      ) : null}

      {view === "grid" ? (
        <OneScreenGrid
          students={visible}
          reports={reports}
          config={{
            attitudes: ATTITUDE,
            homeworks: HOMEWORK,
            allowTestMax: allowTeacherTestMax,
            dailyEnabled: showDailyTest,
            checkEnabled: showCheckTest,
            attachmentUrls: attUrls,
            attachmentsHidden: !showAttachments,
          }}
          fields={{
            onAttendance: setAttendanceFor,
            onProgress: setProgressFor,
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
          }}
          bulkActions={{
            onSaveAll: saveAllVisible,
            onSendAll: sendAllVisible,
            onAutoWriteAll: autoWriteAllVisible,
            onClassNotice: openNoticeForRows,
            onBulkApply: bulkApplyValues,
            onBulkImportPrev: bulkImportPrev,
            onBulkAttach: (keys, files) => void bulkAttach(keys, files),
          }}
          uploadingAttKey={uploadingAttKey}
          order={orderClass ? { classId: orderClass.id, onSave: saveOrderForClass } : undefined}
          classFilter={activeClassFilter}
          // 반 서술(G6) — 순서 기능과 동일한 동명 반 가드(orderClass = 이름 매칭이 유일할 때만).
          // 키 = classId: 이름 키면 동명 두 반(수학·영어)에 서술이 교차 주입됨(리뷰 확정 major).
          narrative={{
            activeClass: orderClass ? orderClass.name : null,
            value: orderClass ? (classNarratives[orderClass.id] ?? "") : "",
            onSave: (text) => {
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
        <StatusBoard students={visible} reports={reports} onOpenCard={openCard} />
      ) : view === "history" ? (
        <HistoryBoard />
      ) : view === "notice" ? (
        <NoticeComposer
          key={`notice-${noticeSeed?.join(",") ?? ""}`}
          students={visible}
          seedStudentIds={noticeSeed}
          sendEnabled={classnoteSendEnabled}
          onSent={() => setNoticeSeed(null)}
        />
      ) : (
      /* 3열 폭 배분 — 콘텐츠 양에 비례하게. 예전 `1fr` + `380px 상한`은 정반대라, 짧은 진도·테스트 카드가
         남는 폭을 다 먹고(넓은 화면에서 1000px+ 공백) 제일 긴 보고서가 380px에 갇혀 세로로만 늘어났다(원장 지적 07-21).
         이제 보고서 열이 더 넓고, 카드 폭 ≥672px이면 보고서 내부가 2열로 펼쳐진다(@container). */
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start 2xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,2fr)]">
        <StudentList
          students={visible}
          selId={effectiveId}
          onSelect={setSelId}
          reportCellById={reportCellById}
          classOrder={classTags.filter((t) => t !== "전체")}
          testConfig={testCfg}
        />

        {selected ? (
          <>
            {/* 중앙 그룹 — 좌측 학생목록·우측 보고서와 함께 3열 워크플로 영역을 그룹 제목으로 구분. */}
            <div className="flex flex-col gap-3">
              <header className="flex items-center gap-1.5">
                <EyIcon name="chart" size={14} className="text-primary" />
                <h2 className="text-foreground text-sm font-bold">오늘 진도 · 테스트</h2>
              </header>
              <ProgressCard
                student={selected}
                onConfirm={confirmProgress}
                onProgress={setProgress}
                onStudyGrade={setStudyGrade}
                onLoadPrev={
                  selected.isMakeup && !prevLoaded.has(selected.id)
                    ? () => loadMakeupPrev(selected.id)
                    : undefined
                }
              />
              <TestCard student={selected} onScore={setScore} allowMax={allowTeacherTestMax} onMax={setMax} dailyEnabled={showDailyTest} checkEnabled={showCheckTest} />
            </div>
            <div className="flex flex-col gap-3">
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
                student={selected}
                reports={reports[selected.id] ?? {}}
                attitudes={ATTITUDE}
                homeworks={HOMEWORK}
                onAttitude={setAttitude}
                onHomework={setHomework}
                onTextbook={setTextbook}
                onHomeworkToday={setHomeworkToday}
                onMakeup={toggleMakeup}
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
                  onSet: (classId, s) => setAttendanceFor(selected.id, classId, s),
                }}
                // 실효 모드 = 강사 오버라이드 ?? 학원 기본 — 상단 토글이 하단 보고서 입력 구성을 실제로 바꾼다.
                noticeMode={noticeMode ?? academyNoticeMode}
              />
            </div>
          </>
        ) : (
          <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm lg:col-span-2">
            학생을 선택하세요
          </div>
        )}
      </div>
      )}

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
    </div>
  );
}
