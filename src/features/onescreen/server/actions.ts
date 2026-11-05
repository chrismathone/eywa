"use server";

import { isSrsDraftText, jjBooksOnly } from "../jj-books";
import { LAST_TEMPLATE_BY_CLASS_PREF, LAST_TEMPLATE_PREF, isTemplateIdShape, readTemplatePrefs, rememberTemplate } from "../last-template";
import { normalizeNoneMarker } from "../none-marker";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { preserveMakeupSessionEntries, type SessionProgress } from "../makeup-session";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { addDays, kstToday, resolveReportDate } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { type ReportCommentInput } from "../report-comment";
import { mentMaxTokens, mentSections, readMentResponse } from "../ment-assembly";
import { buildTrendInput, TREND_HISTORY_FETCH_DAYS, type TrendInput } from "../trend-comment";
import { resolveReportClassId } from "@/features/report-admin/server/resolve-class";
import { assembleCombined, MENT_AI_TUNING } from "../prompt-defaults";
import { loadActivePrompt } from "./prompt-loader";
import {
  fetchReportTrendRows,
  fetchScoreHistory,
  fetchSpecialClassIds,
  hasLaterScoredReport,
} from "./score-history";
import type { TrendReportRow } from "../report-trend";
import { getTenantSettings } from "@/features/owner/server/queries";
import { makeupReportUpsertBlock } from "@/features/makeups/server/adapters/gates";
import type { MakeupEffectNotice } from "@/features/makeups/server/adapters/effects";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { classnoteSendWindowHint, isClassnoteAllowed, isClassnoteSubjectEnabled } from "../classnote-guard";
import { hasClassnoteNameCollision, teacherOwnsStudent } from "./scope";
import { sameSessionRevision, sessionContentFromRow, sessionSaveDecision, type SessionContent } from "../session-write";
import { isRecallInFlight } from "@/features/report-admin/report-recall";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { getTeachingClassIds, getTeachingClasses } from "@/features/classes/server/delegation";
import { hasAnyAttendance, isStudentAbsentForSend } from "./absence-gate";
import { isReportOptout } from "@/features/classes/report-optout";
import {
  ensureMakeupAttendanceForReport,
  resolveMakeupOwner,
} from "@/features/attendance/server/makeup-pool";
import { claimMakeupAnchorChange, finishMakeupAnchor, prepareMakeupAnchor } from "./makeup-anchor-sync";
import { ingestReport } from "@/features/progress/server/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAKEUP_CHECK_REQUIRED_ERROR, makeupCheckPending } from "@/features/attendance/server/makeup-check-gate";
import { after } from "next/server";
import {
  nextTrendOptOut,
  readTrendOptOut,
  TREND_OPTOUT_PREF,
  trendOptOutKey,
} from "../trend-optout";
import { getTextbookOrdersForStudents } from "@/features/billing/server/textbook-queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { parseExamScores } from "../exam-info";
import {
  DEFAULT_ONESCREEN_FONT_SIZE,
  ONESCREEN_FONT_SIZES,
  type OnescreenFontSize,
} from "../font-size";
import { LEGACY_REPORT_SUBJECT, reportSubject } from "@/features/timetable/lib/report-subject";
import { todaysMathSameForReport } from "./todays-math-fill";
import { attachExamReportBeforeSend } from "@/features/integrations/todays-math/exam-report-attach";
import { resolveMentSource, type MentSource } from "../ment-source";
import { mentSourceColumnReady } from "./ment-source-db";
import { recordMentAiDraft } from "./ment-draft-db";
import { refreshTeacherMentStyle } from "./ment-style-build";
import { MENT_STYLE_EXCLUDED_SUBJECTS } from "../ment-style";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { videoHomeworkKept } from "@/features/video-homework/report-owner";
import { cancelledAfterSeen } from "@/features/video-homework/server/cancels";
import { resolveNextLessonDue, videoHomeworkDueColumnReady } from "@/features/video-homework/server/report-due";
import type { SavedVideoHomeworkDue } from "@/features/video-homework/due";
import { decideVideoHomeworkDue } from "@/features/video-homework/due-write";
import { isCustomDue } from "@/features/video-homework/due";
import { getVideoReceiptComment } from "@/features/video-homework/server/receipt-comment";
import { appendVideoReceiptComment } from "@/features/video-homework/receipt-comment";
import { videoSubmitLinkColumn } from "@/features/video-submit/server/link-choice-db";
import { loadTeacherMentStyle } from "./ment-style-db";
import { expectedVideoDue, videoDueTextMismatch } from "@/features/video-homework/due-text-check";
import { loadSectionEditExamples, restylePilotSections, type SectionEditExample } from "./pilot-restyle";
import { transplantRestyle } from "../pilot-restyle-guard";
import type { MentStyleProfile } from "../ment-style";
import { mentStyleDirective, mentStyleToneDirective } from "../ment-style-prompt";
import { prependParentAddress, splitParentAddress } from "../parent-address";
import {
  clampUnderstanding,
  composePilotMent,
  isMathReportPilot,
  PILOT_AUTOWRITE_REQUIRED_ERROR,
  PILOT_ONELINE_REQUIRED_ERROR,
  pilotOneLineAttached,
  ENGLISH_ONELINE_REQUIRED_ERROR,
  PILOT_REASON_REQUIRED_ERROR,
  pilotLessons,
  cleanPilotUnderstanding,
  pilotAiDirective,
  PILOT_SECTION_TITLES,
  pilotSection,
  progressLead,
  ratedUnderstanding,
  readLessonMemo,
} from "../math-report-pilot";
import { applyHabitsToSections, dropScoreLines, NO_HABITS, type TeacherHabits } from "../teacher-habits";
import { loadTeacherHabits } from "./teacher-habits-db";
import { beforeClassReportEnabled, loadBeforeClassReportRows } from "@/features/before-class/server/report-rows";
import type { ReportCheckRow } from "@/features/before-class/items";
import { pilotBody, pilotLevelsSection, readAttitudeNote, readHomeworkMissReason, readTestSkip, type DailyTestSkip } from "../math-report-pilot-sections";
import { skipStatusOf } from "../progress-status";
import type { Variety } from "../ment-variants";
import { prevPhrasingHint } from "../pilot-notes";
import { fetchPrevReportNotes } from "./prev-notes";
import { logAction } from "@/features/audit/server/log";
import { isSlotOnlyEnglishNotes, shouldCaptureJj } from "../jj-capture-plan";
import { classRouteActive, NO_SEND_CLASS_ERROR, SEND_CLASS_SUBJECTS } from "../send-class";
/** 영상 숙제 마감이 고른 것과 다르게 저장된 줄은 보내지 않는다(saveAndQueueClassnote — 까닭은 화면이 따로 알린다, due-write.ts). */
const VIDEO_DUE_CHANGED_ERROR = "영상 숙제 마감이 고른 것과 달라져 보내지 않았습니다(저장은 했습니다) — 멘트의 마감을 확인한 뒤 다시 보내 주세요";
/** 장부에서 취소된 영상 숙제를 이 화면이 모른 채 '있음'으로 보낸 줄 — '없음'을 지키고 보내지 않는다(원장 2026-10-16, cancels.ts). */
/** 글에 적힌 영상 숙제 마감이 저장한 마감과 다르다(원장 2026-10-28, video-homework/due-text-check.ts) — 글만 고친 마감은 사이트·미수행 판정과 갈린다. */
const VIDEO_DUE_TEXT_MISMATCH_ERROR = "글에 적힌 영상 숙제 마감이 정한 마감과 달라 보내지 않았습니다(저장은 했습니다) — 글을 고치지 말고 영상 숙제 '기한'(7일 · 다음 수업)을 바꾼 뒤 자동작성을 다시 눌러 주세요";
const VIDEO_HW_CANCELLED_ERROR = "이 영상 숙제는 영상 제출 현황에서 취소돼 '없음'으로 되돌렸고, 보내지 않았습니다(저장은 했습니다) — 멘트에 영상 숙제 안내가 있으면 고친 뒤 다시 보내 주세요";
import { classBoardLiveForStudent, explainBoardMissing, resolveMakeupSendClass } from "./send-class";
import { captureReportJj } from "./jj-capture";
import type { OneScreenStudent, PrevReport } from "../types";
import { humanizeDbError, logDbError } from "@/lib/supabase/db-error";


/**
 * 발송 대기에 올려도 되는 행 = 워커가 **집지도(processing) 보내지도(success) 않은** 행. 맨 위의 확인과 쓰기 사이에
 * 워커가 끝낼 수 있어 쓰기 자체에 거는 조건(compare-and-set) — 9/29 박세욱 재클릭 중복 게시(ClassNote는 지울 수 없다).
 */
const CLASSNOTE_REQUEUE_OK = "classnote_status.is.null,classnote_status.not.in.(processing,success)";

export type SaveLessonReportInput = {
  studentId: string;
  textbook?: string; // 교재명 — 0089a(학부모 카드 showTextbook)
  makeup?: boolean; // 보강 수업 여부 — 0089a
  homeworkToday?: string; // 오늘 과제(숙제 내용) — 0096a(학부모 카드 showHomeworkToday, AI 멘트 재료)
  /**
   * 오늘 영상 과제 있음/없음(0308a) — `undefined`면 손대지 않는다(저장해 둔 값 유지 · 모르는 경로). 컬럼이 아직 없으면
   * 서버가 조용히 뺀다(#95). 다음 수업의 '지난 수업 영상 숙제' 검사는 false일 때만 숨는다(assignment.ts).
   */
  videoHomework?: boolean;
  /**
   * 이 화면이 그 줄의 영상 과제 값을 DB와 맞춘 시각(ISO, 원스크린 공급자 `seenAtOf`) — 장부에서 취소한 숙제를 모른 채 보낸 '있음'을
   * 가른다(`cancels.ts`). 없으면 모른 것으로 본다(취소 기록이 있을 때만 뜻이 있다).
   */
  videoHomeworkSeenAt?: string | null;
  /**
   * 영상 첨부 링크 넣기(0328a, 원장 2026-10-02) — `undefined`면 손대지 않는다. 컬럼이 아직 없으면 서버가 조용히 뺀다(#95).
   * 발송 직전 판정(`reportGetsVideoLink`)이 이 값이 true인 보고서에만 '영상첨부' 줄을 붙인다.
   */
  videoSubmitLink?: boolean;
  /**
   * 영상 숙제 마감(원장 2026-10-15, video-homework/due.ts) — 7일 · 다음 수업. `undefined`면 손대지 않는다. 날짜는 받지 않는다 —
   * '다음 수업'이면 서버가 시간표로 정한다. 칸이 아직 없으면 조용히 뺀다(#95).
   */
  videoHomeworkDue?: "week" | "next";
  progress: string; // "영어 Unit 8 · p.90"
  examInfo: string; // "일일 18/20, 확인 19/20" (roster prev-score 파싱용 합본 — 보존)
  homeworkScore: string; // 과제 상태
  notes: string; // 학부모 보고서 본문
  dailyTest?: string; // "20문제 중 18개" (학부모 보고서 일일테스트 표시용)
  checkTest?: string; // "20문제 중 19개"
  attitude?: string; // "좋음"
  trendNote?: string; // 학습 추세(종합분석) 문구 — 0091a. 멘트(notes)와 별개 저장·표시.
  reportDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 마감·재발송용(report_date=카드·ClassNote 게시일).
  subject?: string; // 과목키(math/english…) — 발송 과목 게이트·보드 매핑의 키. 반이 없을 때의 dedup 단위이기도 하다.
  /**
   * 이 보고서가 속한 반(수업) — **보고서 1건의 단위**(0134a). 같은 날 정규 수학 + 수학 특강을 들어도
   * 서로 안 덮게 하는 키다(`unit_key = coalesce(class_id, subject)` 유니크).
   * null 허용: 보강·수업외 수동 추가처럼 반이 없는 저장(그때는 예전대로 과목이 단위).
   */
  classId?: string | null;
  /**
   * 보강 행이 **어느 수업 시간에** 진행됐는가(0171a). 표시·반 필터 앵커 전용 —
   * 🔴 `class_id`에 넣으면 안 된다(unit_key가 coalesce(class_id,subject)라 같은 반 정규 보고서와 충돌).
   */
  makeupClassId?: string | null;
  // 보강·수업외 학생(수동 추가) — true면 '내 담당 반 활성 수강생' 검사 대신 같은 학원(tenant) 학생이면 허용.
  // 원장 승인 정책(보강 저장=학원 전체). RLS가 테넌트 격리(cross-tenant는 select null) → 학원 밖 학생은 여전히 거부.
  outOfClass?: boolean;
  /**
   * 멘트 작성 방식(0214a) — 클라 판정(computeClientMentSource: 이번 세션 자동작성 스냅샷과 비교).
   * 서버가 resolveMentSource로 저장돼 있던 라벨과 합쳐 최종 확정한다(어제 AI 멘트를 오늘 고치는 경우 강등).
   * 미지정(구 클라·직접 호출)이어도 저장은 그대로 — 라벨만 보수적으로(null 또는 auto_edited) 남는다.
   */
  mentSource?: MentSource;
  /** 수학 보고서 시범 — 강사 한줄 멘트(필수, 원장 2026-10-22). 보낼 글 맨 끝에 그대로 붙어 있어야 발송한다. */
  pilotOneLine?: string;
  /**
   * JJ 수업보고서로 쓴 영어 글(원장 2026-10-27) — 사랑의 한마디가 **선택**이라 '영어 한마디 필수'를 건너뛴다(비우면 글에서 그 항목이 빠진다).
   * 화면이 글의 템플릿(templateId)으로 판정해 싣는다. 강사 자신의 선택 칸을 비우는 것뿐이라 화면 판정을 그대로 믿는다.
   */
  jjSheet?: boolean;
  /**
   * 새 수학 보고서 발송 조건(화면이 pilot-send-gate.ts로 판정, 원장 2026-10-26) — 자동작성이 지금 칸 값 기준인가 · 시험 없음/숙제 미제출
   * 사유를 다 적었나. 일괄 발송이 화면 게이트를 건너 사유 없는 글·옛 출결 글을 보냈던 구멍을 막는다. **없으면 거절**(옛 화면 = 보내지 않는 쪽).
   */
  pilotCheck?: { factsCurrent: boolean; reasonsOk: boolean };
  /**
   * 자동작성 원문(0370a) — 화면이 `mentSource: 'auto_edited'`일 때만 싣는다(선생님이 고친 그 자동작성 글). 말투 프로파일이
   * 원문 ↔ 최종을 견줘 '늘 고치는 것'을 배운다(원장 2026-10-16). 저장 응답 뒤에 따로 적는다 — 본 저장과 무관, 실패해도 저장은 성공.
   */
  mentAutoDraft?: string;
  /**
   * 영어 결과지 고르기(2026-09-28) — 그림 칸 `[시험결과지]`에 붙일 인재원 응시 id. `undefined` = 이 보고서에 저장해 둔
   * 고르기를 따른다(일괄 발송·옛 화면처럼 고르기를 모르는 경로가 고른 것을 풀지 않게), `null` = 기본(그날 낸 시험 전부).
   * 응시가 이 학생 것인지는 서버가 다시 확인한다(ijw/server/report-snapshot.ts).
   */
  jjExamPick?: string[] | null;
  /**
   * ⚠️ **새 화면은 보내지 않는다**(2026-09-30) — 보강 보고서의 '보낼 반'은 보강 반의 복사본이고 따로 고르지 않는다
   * (원장 *"보고서 반 = 출석부 반"*). 옛 화면(배포 중 열린 탭)의 발송 다이얼로그가 보내면 **보강 반으로 받는다**(같은 수용 판정 ·
   * 칸도 함께 옮긴다) — 옛 탭이 '보낼 반'만 바꾸던 길을 새 규칙으로 흡수한다.
   */
  classnoteClassId?: string | null;
};

/**
 * 선생님 원스크린 — 수업 보고서를 lesson_reports(0049a)에 저장.
 * D3: 저장만(메시징/PDF 발송 연동은 후속 웨이브). RLS가 tenant 격리 + 앱단에서 강사 스코프 이중 방어
 * (보고서를 쓰려는 학생이 그 강사 담당 반의 활성 수강생이 아니면 거부 — 다른 반 학생에 임의 기록 차단).
 */
export async function saveLessonReport(
  input: SaveLessonReportInput,
): Promise<{
  ok: boolean;
  id?: string;
  shareToken?: string;
  error?: string;
  /** 저장은 됐지만 알릴 일 — 영어 그림 자리에 넣을 인재원 자료를 못 묶었다(jj-capture-plan.ts, 한국어 문장). */
  warning?: string;
  /** 실제로 저장된 보강 앵커(`makeup_class_id`) — 서버가 확인한 값(발송의 '보낼 반' 판정이 이 값을 쓴다). */
  makeupClassId?: string | null;
  /**
   * 보고서와 출결 칸은 저장됐지만 **보강 기록 반영이 남았다** — 화면이 저장 성공과 나눠 알린다(되돌리지 않는다, 다시 보내지 않는다).
   * 평소엔 없다. 보강 칸을 세우거나 옮긴 저장에서만 온다(makeup-anchor-cells.ts).
   */
  makeupEffect?: MakeupEffectNotice;
  /** 반 미정 보강이라 저장을 막았다(`MAKEUP_ANCHOR_REQUIRED_ERROR`) — 화면이 보강 반을 고르게 한다. */
  needsAnchor?: boolean;
  /** 영상 과제 값을 작성 선생님 것으로 두었다([`report-owner.ts`]) — 화면이 이 값으로 되돌린다(나머지는 저장됨). */
  keptVideoHomework?: boolean | null;
  /** 장부에서 취소된 숙제라 '없음'을 지켰다(`keptVideoHomework`=false와 함께) · 화면이 그 줄의 맞춘 시각으로 쓸 응답 시각. */
  videoHomeworkCancelled?: true;
  videoHomeworkSeenAt?: string;
  /** 저장한 영상 숙제 마감 — 고른 마감을 적었을 때만. `fellBack` = 14일 안에 다음 수업이 없어 7일로 적었다(화면이 알린다). */
  videoHomeworkDue?: SavedVideoHomeworkDue;
  /** 저장된 멘트 작성 방식(0214a) — 컬럼이 없으면 null. 수학 보고서 시범의 발송 게이트가 읽는다. */
  mentSource?: string | null;
}> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 아래 담당 판정은 user.id(본인) 축이라 대부분 자연 거절되지만,
  // outOfClass(보강·수업외)는 학원 학생 전체가 허용이라 이 가드 없이는 열람 중 저장이 뚫린다.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };

  const supabase = await createClient();

  // 대상 날짜 = 고른 날짜 클램프(빈값·미래→KST 오늘). report_date 단일 소스 = 학부모 카드 표시일 = ClassNote 게시일.
  // 수강생 스코프 판정도 이 날짜 기준(과거 마감 시 그날 수강생) — roster·setAttendanceCell과 통일.
  const reportDate = resolveReportDate(input.reportDate);
  // 감사로그의 오늘 수학 출처 대조는 저장과 **함께** 돌린다(직렬이면 저장 응답이 그만큼 늦다 · 실패해도 빈 배열 — 저장을 막지 않는다).
  const todaysMathSamePromise = todaysMathSameForReport(user.tenantId, {
    studentId: input.studentId, classId: input.classId || null, subject: input.subject || null, date: reportDate,
    dailyTest: input.dailyTest, checkTest: input.checkTest,
  });

  // 강사 스코프: 기본은 '내 담당 반, 대상 날짜 시점 수강생'만. 단 outOfClass(보강·수업외 수동추가)면 같은 학원 학생 전체 허용
  // (원장 승인 정책). RLS가 테넌트 격리 → 학원 밖 학생은 select null로 걸러져 거부됨.
  if (input.outOfClass) {
    const { data: stu } = await supabase
      .from("students")
      .select("id")
      .eq("id", input.studentId)
      .maybeSingle();
    if (!stu) return { ok: false, error: "학원 학생이 아닙니다" };
  } else {
    // 담당 반 ∪ **그 날짜에 위임받은 반**(0173a) — 결근 대체 강사가 실제로 가르친 반의 보고서를 쓴다.
    const { all: myClassIds } = await getTeachingClassIds(supabase, user.id, reportDate);
    if (myClassIds.length === 0) return { ok: false, error: "담당 반이 없습니다" };
    // 반이 지정되면 **그 반**이 내 담당인지까지 본다(0134a) — 예전엔 '내 담당 반 아무거나'만 봐서
    // 남의 반 id를 실어 보내면 그 반 보고서가 만들어졌다(반이 보고서 단위가 되면서 실제 영향이 생긴 구멍).
    if (input.classId && !myClassIds.includes(input.classId))
      return { ok: false, error: "담당 반이 아닙니다" };

    let q = supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", input.studentId)
      .or(`start_date.is.null,start_date.lte.${reportDate}`)
      .or(`end_date.is.null,end_date.gte.${reportDate}`);
    // 반이 지정되면 그 반 수강 여부까지 확인(다른 반 학생에 특강 보고서를 쓰는 것 차단).
    q = input.classId ? q.eq("class_id", input.classId) : q.in("class_id", myClassIds);
    const { data: enr } = await q.limit(1);
    if (!enr || enr.length === 0) return { ok: false, error: "담당 학생이 아닙니다" };
  }

  // 🔴 **발송 완료된 보고서는 수정 금지**(2026-07-22 원장 지시). ClassNote는 게시글 수정·삭제가 없어
  //    학부모는 발송 시점의 이미지를 그대로 갖고 있다. 여기서 내용만 바꾸면 DB와 학부모가 본 것이 갈라져
  //    나중에 어느 쪽이 사실인지 아무도 모른다(문의가 오면 대조할 근거가 사라진다).
  //    이 함수가 저장의 **단일 관문**이라 원스크린·카드·일괄·첨부 자동저장이 전부 여기서 막힌다.
  //    푸는 방법은 공유링크 재발급(reissueShareLink — 상태 리셋 = "이 건은 무효" 선언)뿐이다.
  // ment_source(0214a) 기록 가능 여부 — 컬럼이 아직 없으면(마이그 미적용) 마커만 생략(#95, probe 캐시로 평시 왕복 0).
  // 영상 과제(0308a)도 같은 결 — 값을 실은 저장만 probe한다(나란히, B4). 적용 후엔 캐시라 왕복 0.
  // 영상 첨부 링크 넣기(0328a)도 같다 — 칸이 확인됐을 때만 적는다(없음·못 물어봄이면 이 값만 빠진다).
  // 영상 숙제 마감(원장 2026-10-15)은 영상 과제 값을 실은 저장마다 본다 — 과제를 끄면 마감도 지워야 해서(마감을 안 보내도).
  const [mentReady, videoHwReady, videoLinkReady, videoDueReady] = await Promise.all([
    mentSourceColumnReady(supabase),
    input.videoHomework === undefined ? Promise.resolve(false) : videoHomeworkColumnReady(),
    input.videoSubmitLink === undefined ? Promise.resolve(false) : videoSubmitLinkColumn().then((state) => state === "ready"),
    input.videoHomework === undefined ? Promise.resolve(false) : videoHomeworkDueColumnReady(),
  ]);
  const gateBase = supabase
    .from("lesson_reports")
    // 멘트 작성 방식 판정 재료(notes, ment_source)를 게이트 pre-read에 **합승**시킨다 — 별도 왕복 없음(B4).
    // 보강 앵커 판정 재료(옛 앵커·게시 기록·소유자)도 같은 pre-read에 합승한다 — 반을 옮길 때 칸을 먼저 확인해야 해서.
    // 영상 과제 작성자 판정 재료(지금 값)도 합승한다 — 값을 실은 저장이고 칸이 확인됐을 때만(#95).
    .select(
      (mentReady
        ? "id, classnote_status, classnote_sent_at, makeup_class_id, created_by, notes, ment_source"
        : "id, classnote_status, classnote_sent_at, makeup_class_id, created_by") + (videoHwReady ? ", video_homework" : "")
        // 영상 숙제 마감(원장 2026-10-15)도 같은 사전 조회에 합승 — '다음 수업'으로 이미 정한 날짜는 다시 계산하지 않는다(due-write.ts).
        + (videoHwReady && videoDueReady ? ", video_homework_due" : ""),
    )
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate);
  const gateScoped = input.classId
    ? gateBase.eq("class_id", input.classId)
    : input.subject
      ? gateBase.is("class_id", null).eq("subject", input.subject)
      : gateBase.is("class_id", null).is("subject", null);
  // '학습 추세 미발송'(원장 2026-09-18) — 본인 계정 ui_prefs에서 이 반·학생이 꺼져 있는지. 게이트 pre-read와
  // **병렬**(B4)이고, 비울 추세가 있을 때만 읽는다(대부분의 저장은 왕복 0). 읽기 실패는 종전 동작(발송)으로 둔다 —
  // 화면이 이미 빼서 보내므로 여기는 두 번째 방어선이다.
  const trendOptOutKeyForSave = input.trendNote ? trendOptOutKey(input.classId, input.studentId) : null;
  const [{ data: gateRows }, trendOptedOut] = await Promise.all([
    gateScoped.limit(1),
    trendOptOutKeyForSave
      ? createAdminClient()
          .from("users")
          .select("ui_prefs")
          .eq("id", user.id)
          .eq("tenant_id", user.tenantId)
          .maybeSingle()
          .then(
            ({ data: me }) => readTrendOptOut(me?.ui_prefs).includes(trendOptOutKeyForSave),
            () => false,
          )
      : Promise.resolve(false),
  ]);
  const priorRow = gateRows?.[0] as
    | {
        id: string;
        classnote_status: string | null;
        classnote_sent_at?: string | null;
        makeup_class_id?: string | null;
        created_by?: string | null;
        notes?: string | null;
        ment_source?: string | null;
        video_homework?: boolean | null;
        video_homework_due?: string | null;
      }
    | undefined;
  if (priorRow?.classnote_status === "success") {
    return {
      ok: false,
      id: priorRow.id,
      error: "이미 학부모에게 발송된 보고서라 수정할 수 없습니다 — 고쳐야 하면 공유링크를 재발급하세요",
    };
  }
  // 🔴 영상 과제 있음/없음은 이 줄을 처음 쓴 선생님만 바꾼다(원장 2026-10-03, [`report-owner.ts`]) — 강사뷰 '영상 제출 현황'이
  //    작성 계정으로 "내가 낸 숙제"를 가르므로, 다른 선생님이 켜면 켠 사람 장부에 안 뜬다. **거절하지 않고** 그 값만 두고
  //    나머지를 저장한다(거절하면 세션이 바꾼 값을 쥐고 있어 그 줄의 저장·발송이 계속 막힌다) — 둔 값은 화면에 돌려준다.
  const ownerKept = videoHomeworkKept({
    prior: priorRow ? { createdBy: priorRow.created_by ?? null, videoHomework: priorRow.video_homework ?? null } : null,
    wanted: videoHwReady ? input.videoHomework : undefined,
    userId: user.id,
  });
  // 🔴 장부에서 취소한 숙제(원장 2026-10-16, `cancels.ts`) — 이 화면이 그 취소를 **모른 채**(값을 맞춘 시각 < 취소 시각) '있음'을 보내면
  //    '없음'을 지킨다(세션 초안이 쥔 옛 '있음'이 보고서에 다시 적히던 길). 같은 길로 그 값만 두고 나머지는 저장하고, 발송은 하지 않는다
  //    (saveAndQueueClassnote — 멘트에 영상 숙제 안내가 남아 있을 수 있다). 기록은 '없음'인 줄에 '있음'을 보낼 때만 읽는다(평소 왕복 0).
  const cancelKept = !ownerKept && videoHwReady && input.videoHomework === true && priorRow?.video_homework === false && !!input.classId
    && await cancelledAfterSeen(createAdminClient(), user.tenantId, { classId: input.classId, studentId: input.studentId, date: reportDate }, input.videoHomeworkSeenAt);
  const keptVideoHw = ownerKept ?? (cancelKept ? { kept: false } : null);

  /**
   * 🔴 보강 앵커(`makeup_class_id`) — **보고서 반 = 출석부 반 = 발송 반**의 단일 소스(원장 2026-09-30, [`makeup-anchor.ts`](../makeup-anchor.ts)).
   *  · 클라가 준 반 id를 그대로 믿지 않는다 — 받을 반 = 담당 반 ∪ 학생이 다니는 반 · 같은 과목 · 종강 전(`acceptMakeupAnchor`,
   *    원장 결정 2: 위임 없이 남의 반 학생을 대신 보강하면 **학생의 원래 반**으로).
   *  · 받을 수 없으면 **저장 오류**다(예전엔 조용히 옛 값으로 두어 화면과 DB가 갈렸다 — C3).
   *  · 이미 저장된 앵커는 그대로 받는다(그 뒤 종강·위임 종료돼도 재저장이 앵커를 지우거나 막지 않게). 비워 보내도 지우지 않는다.
   *  · 반별 발송 대상(수학 · ClassNote 반 경로)인데 앵커가 없으면('반 미정') 저장을 막는다 — 반 없는 기록을 만들지 않는다(설계 f).
   *  · 앵커가 바뀌면 출결 칸을 **함께** 옮긴다 — 칸에서 막힐 일은 **저장 전에** 확인한다(보고서만 바뀌면 둘이 갈린다).
   */
  const isMakeupRow = !!input.makeup && !input.classId;
  let makeupEffect: MakeupEffectNotice | undefined;
  let makeupAnchor: string | null = null;
  let priorAnchor: string | null = null;
  let anchorMove: Extract<Awaited<ReturnType<typeof prepareMakeupAnchor>>, { ok: true }>["move"] = null;
  if (isMakeupRow) {
    const prepared = await prepareMakeupAnchor(supabase, {
      tenantId: user.tenantId,
      candidatesFor: user.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject,
      wanted: input.classnoteClassId ?? input.makeupClassId ?? null,
      prior: priorRow
        ? {
            makeupClassId: priorRow.makeup_class_id ?? null,
            classnoteStatus: priorRow.classnote_status,
            classnoteSentAt: priorRow.classnote_sent_at ?? null,
            createdBy: priorRow.created_by ?? null,
          }
        : null,
      anchorRequired: async () =>
        SEND_CLASS_SUBJECTS.has(input.subject ?? "") && classRouteActive(await getTenantSettings(), user.displayName),
    });
    if (!prepared.ok)
      return {
        ok: false,
        ...(priorRow ? { id: priorRow.id } : {}),
        error: prepared.error,
        ...(prepared.needsAnchor ? { needsAnchor: true } : {}),
      };
    makeupAnchor = prepared.anchor;
    priorAnchor = prepared.priorAnchor;
    anchorMove = prepared.move;
    // 옛 행의 반이 바뀌면 upsert 전에 조건부로 먼저 바꾼다 — 사이에 워커가 집으면(옛 반으로 게시 중) 둘 중 하나만 이긴다.
    if (priorRow && makeupAnchor && makeupAnchor !== priorAnchor) {
      const claimed = await claimMakeupAnchorChange({ tenantId: user.tenantId, reportId: priorRow.id, from: priorAnchor, to: makeupAnchor });
      if (!claimed.ok) return { ok: false, id: priorRow.id, error: claimed.error };
    }
  }

  const reportBlock = await makeupReportUpsertBlock({
    makeup: isMakeupRow, classId: input.classId || null, subject: input.subject ?? "",
    studentId: input.studentId, date: reportDate, creating: !priorRow, existingReportId: priorRow?.id ?? null,
  });
  if (reportBlock) return { ok: false, ...(priorRow ? { id: priorRow.id } : {}), error: reportBlock };

  /**
   * 🔴 영상 숙제 마감(원장 2026-10-15, video-homework/due.ts) — 영상 과제 값과 같은 주인이다: 그 숙제를 낸 선생님(이 줄을 처음 쓴 사람)만 바꾼다
   * (report-owner.ts — 다른 선생님이 고치면 학부모에게 나간 마감이 바뀐다. 화면 겹은 토글 잠금).
   *  · 판정 전부 = `decideVideoHomeworkDue`(video-homework/due-write.ts — 과제를 끄면 지움 · 7일 · 다음 수업은 시간표로 찾아 날짜로 고정 ·
   *    이미 정한 날짜는 그대로 · 못 찾음/이미 지남/못 읽음은 7일로 알림 · 남이 쓴 줄은 저장값을 돌려줌). DB 트리거(0425a)가 남의 갱신을 한 번 더 막는다.
   */
  const videoDue = await decideVideoHomeworkDue({
    ready: videoDueReady && videoHwReady, videoHomework: input.videoHomework, mode: input.videoHomeworkDue,
    keptVideoHw: !!keptVideoHw, hasClass: !!input.classId,
    owner: !priorRow?.created_by || priorRow.created_by === user.id,
    priorDue: priorRow?.video_homework_due ?? null, reportDate, today: kstToday(),
    resolveNext: () => resolveNextLessonDue(createAdminClient(), { tenantId: user.tenantId, classId: input.classId!, studentId: input.studentId, reportDate })
      .catch((e) => {
        console.warn(JSON.stringify({ level: "warn", scope: "saveLessonReport.videoHomeworkDue", message: e instanceof Error ? e.message : String(e) }));
        throw e;
      }),
  });
  const videoDueWrite = videoDue.write ?? null;
  const videoDueSaved: SavedVideoHomeworkDue | null = videoDue.saved ?? null;

  // 멘트 작성 방식(0214a) — 클라 판정 + 기존 라벨 sticky 합산(ment-source.ts). 컬럼 없으면 통째 생략(#95).
  //    아래 자동작성 원문 기록(0370a)도 이 최종 값으로 판정한다.
  const mentSourceFinal = mentReady
    ? resolveMentSource({ client: input.mentSource, prevSource: priorRow?.ment_source, prevNotes: priorRow?.notes, nextNotes: input.notes })
    : null;

  // (student, date, 반|과목) 1행 upsert — 재저장 시 같은 행 갱신(0134a `unit_key` 유니크).
  // ⚠️ onConflict 타깃은 **생성열 unit_key**(= coalesce(class_id::text, subject)) — 부분·표현식 인덱스는
  //    supabase-js upsert가 타깃으로 못 잡아서(0083a 교훈) 생성열로 평범한 컬럼처럼 만들어 둔 것이다.
  // share_token은 update 시 payload에 없어 미변경(안정 링크). classnote_* 도 미변경(별도 saveAndQueueClassnote가 관리).
  const { data: savedData, error } = await supabase
    .from("lesson_reports")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: input.studentId,
        report_date: reportDate,
        subject: input.subject || null,
        class_id: input.classId || null,
        // JJ 수업보고서 글은 세 권 중 고른 것만(jj-books.ts) — 화면도 거르지만 서버가 한 번 더 거른다(#77).
        // 글이 SRS 양식이면 표시가 없어도 거른다(복사한 사용자 템플릿 · 옛 화면, 원장 2026-10-30).
        textbook:
          (input.subject === "english" && (input.jjSheet || isSrsDraftText(input.notes))
            ? jjBooksOnly(input.textbook)
            : input.textbook) || null,
        makeup: input.makeup ?? false,
        // 자유입력 자리표시자(`-`·`X` 등)를 "없음" 하나로 표준화(none-marker.ts 규약, 원장 2026-07-23) —
        // 그대로 두면 학부모 카드에 "오늘 과제: -"가 나가고 AI 멘트가 그걸 사실로 받는다.
        homework_today: normalizeNoneMarker(input.homeworkToday),
        // 작성 선생님이 아니면 영상 과제(와 거기 딸린 첨부 링크 선택)는 적지 않는다(keptVideoHw, 위).
        ...(videoHwReady && typeof input.videoHomework === "boolean" && !keptVideoHw ? { video_homework: input.videoHomework } : {}),
        ...(videoLinkReady && typeof input.videoSubmitLink === "boolean" && !keptVideoHw ? { video_submit_link: input.videoSubmitLink } : {}),
        ...(videoDueWrite ?? {}),
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: normalizeNoneMarker(input.homeworkScore),
        // 보강 행일 때만 앵커를 남긴다(정규 행에 들어가면 필터가 엉킨다). 미지정('전체'에서 추가)은 null.
        makeup_class_id: makeupAnchor,
        // 🔴 보강 행의 '보낼 반'(0303a)은 앵커의 **복사본**이다 — 따로 정하지 않는다(발송 반 = 보고서 반, 원장 2026-09-30).
        //    이미 어딘가 게시된 행(`classnote_sent_at`)은 다시 적지 않는다 — 회수가 그 기록으로 글을 찾는다.
        ...(isMakeupRow && makeupAnchor && !priorRow?.classnote_sent_at ? { classnote_class_id: makeupAnchor } : {}),
        daily_test: input.dailyTest || null,
        check_test: input.checkTest || null,
        attitude: input.attitude || null,
        teacher_name: user.displayName ?? null,
        // 소유(누구 원스크린에 뜨는가) = 계정 id(0172a). 표시용 담임 이름과 분리 —
        // ⚠️ 갱신 때는 DB 트리거가 **원 작성자를 보존**한다(남이 고쳐도 작성자 화면에서 안 사라지게).
        created_by: user.id,
        notes: input.notes || null,
        // '학습 추세 미발송'(원장 2026-09-18)이면 서버도 한 번 더 비운다 — 화면이 이미 빼서 보내지만, 다른 탭의
        // 옛 화면(체크 전 상태)이 저장하면 추세가 다시 실린다([[#77]]). 발송(saveAndQueueClassnote)도 이 함수를 지난다.
        trend_note: trendOptedOut ? null : input.trendNote || null,
        source: "onescreen",
        // 멘트 작성 방식(0214a) — 위 mentSourceFinal. 컬럼 없으면 통째 생략(#95).
        ...(mentReady ? { ment_source: mentSourceFinal } : {}),
      },
      { onConflict: "tenant_id,student_id,report_date,unit_key" },
    )
    // teacher_name은 진도 점프 경고의 "같은 선생님" 축(2026-08-20) — 넘길 값을 여기서 다시 조립하지 말고
    // **저장된 그 값**을 되받는다(갱신 시 DB가 원 작성자를 보존하는 경로가 있어 화면 값과 갈릴 수 있다).
    // created_by도 되받는다 — 보강 출석부 칸의 **귀속 강사**(아래 훅)는 저장자가 아니라 이 소유 계정이다.
    // 영상 과제 값도 되받는다(칸이 확인됐을 때만) — 동시 첫 저장에서 DB 트리거(0336a)가 남의 값을 지켰는지 본다(아래 raceKept).
    // 마감도 같다(트리거 0425a — 아래 raceDue).
    .select(videoHwReady
      ? (videoDueReady ? "id, share_token, teacher_name, created_by, video_homework, video_homework_due" : "id, share_token, teacher_name, created_by, video_homework")
      : "id, share_token, teacher_name, created_by")
    .single();
  // select가 두 리터럴 중 하나라 결과 타입을 추론하지 못한다 — 되받는 칸을 여기 적는다(위 select와 같이 고칠 것).
  const data = savedData as unknown as {
    id: string;
    share_token: string;
    teacher_name: string | null;
    created_by: string | null;
    video_homework?: boolean | null;
    video_homework_due?: string | null;
  } | null;
  if (error || !data) {
    // 먼저 바꿔 둔 반(claimMakeupAnchorChange)을 되돌린다 — 저장이 안 됐는데 반만 바뀌면 칸과 갈린다.
    if (priorRow && makeupAnchor && makeupAnchor !== priorAnchor)
      await claimMakeupAnchorChange({ tenantId: user.tenantId, reportId: priorRow.id, from: makeupAnchor, to: priorAnchor }).catch(() => undefined);
    return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };
  }

  // 선생님이 자동작성 글을 **고쳐** 저장했으면 그 자동작성 원문을 따로 남긴다(0370a) — 말투 프로파일이 '늘 고치는 것'을 배운다.
  // 🔴 응답 뒤에(`after`) — 원스크린 저장은 전원이 매일 쓰는 길이라 늦추지 않는다. 표가 없으면 도우미가 조용히 건너뛴다(#95).
  // 영어는 템플릿 모드라 코퍼스 밖(MENT_STYLE_EXCLUDED_SUBJECTS). 화면도 'auto_edited'라고 말한 저장만 — sticky 강등(어제 AI 글을 오늘
  // 새 세션에서 고침)은 원문 스냅샷이 화면에 없다.
  const aiDraft = input.mentAutoDraft?.trim();
  if (mentSourceFinal === "auto_edited" && input.mentSource === "auto_edited" && aiDraft && !MENT_STYLE_EXCLUDED_SUBJECTS.includes(input.subject ?? "")) {
    const draftRow = { tenantId: user.tenantId, reportId: data.id, teacherId: data.created_by ?? user.id, draft: aiDraft };
    after(() => recordMentAiDraft(createAdminClient(), draftRow));
  }
  // 선생님이 직접 쓰거나 고쳐 저장한 글은 **그때마다** 그 강사 말투 프로파일을 다시 접는다(원장 2026-10-28 *"추가 수정을 하면 그에 맞게
  // 매번 학습"*) — 응답 뒤에 · 강사당 1시간에 한 번까지(refreshTeacherMentStyle). 원문 기록(위)이 먼저 끝나야 '늘 고치는 것'에 든다.
  if ((mentSourceFinal === "manual" || mentSourceFinal === "auto_edited") && !MENT_STYLE_EXCLUDED_SUBJECTS.includes(input.subject ?? "")) {
    const styleTenant = user.tenantId;
    const styleTeacher = data.created_by ?? user.id;
    after(async () => {
      // 원문 기록 after가 먼저 등록돼 먼저 돈다 — 그래도 순서를 기대지 않게 잠깐 뒤에 읽는다.
      await new Promise((r) => setTimeout(r, 1500));
      await refreshTeacherMentStyle(createAdminClient(), styleTenant, styleTeacher);
    });
  }

  /**
   * 영어 템플릿 글에 **그림 자리 줄**이 있으면 그날 인재원 자료를 받아 이 보고서에 묶는다(0261a, 2026-09-11) —
   * 학부모 카드(/r·인쇄·ClassNote 캡처)가 그 묶음으로 그림을 그린다. 아래 후처리와 **나란히** 돌리고 마지막에
   * 기다린다(B4). 🔴 수학·그림 없는 글은 부르지 않는다(저장이 느려지지 않게). 못 묶어도 저장은 성공이고 문장만 돌려준다.
   * ⚠️ 발송(saveAndQueueClassnote)도 이 함수를 지나므로 보내는 순간의 자료로 다시 묶인다(인재원 설명서 ⑤).
   */
  const jjCapture = shouldCaptureJj(input.subject, input.notes)
    ? captureReportJj({
        tenantId: user.tenantId,
        reportId: data.id,
        studentId: input.studentId,
        date: reportDate,
        pick: input.jjExamPick,
      })
    : null;

  // 진도 컨테이너 반영(edutrix 이식) — 저장 성공 후 동기. 비수학·진도없음·이미반영은 내부에서 즉시 skip.
  // 실패해도 저장은 유지(비치명적, 백필로 보정 가능). RLS는 supabase(테넌트 스코프)가 담당.
  try {
    await ingestReport(supabase, {
      id: data.id,
      tenantId: user.tenantId,
      studentId: input.studentId,
      reportDate,
      subject: input.subject || null,
      progress: input.progress || null,
      teacherName: data.teacher_name ?? null,
    });
  } catch {
    /* 진도 반영 실패는 보고서 저장을 막지 않음 */
  }

  /**
   * **보강 보고서를 쓰면 출석부에 칸이 선다**(원장 2026-09-02 *"보고서 발송건에 대해서는 자동 입력 되어야지"*).
   *
   * 🔴 **앵커가 있으면 앵커 반에만**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 예약 반·보이지 않는 보강 반으로 새지 않는다.
   *    옛 앵커(또는 보이지 않는 보강 반)에 있던 칸은 **옮기고**(시수·메모 보존), 그래도 없으면 새로 세운다. 대신 보강(보강한 강사가
   *    그 반 담당이 아니다)이면 그 칸만 강사 몫으로 적는다(`taught_by`, 원장 결정 3).
   *    예전엔 확인창이 칸을 **기다리지 않고** 먼저 적었고(`persistAnchorMakeup`) 실패하면 이 훅이 다른 반에 칸을 세웠다(C2) —
   *    이제 칸은 서버의 이 훅 하나가 **기다려서** 적는다. 실패하면 저장 오류로 돌려준다(발송도 멈춘다).
   * 🔴 시수·결석분 메모는 확인창이 명단 세션에 적어 둔 값(`registerMakeupEntries`)을 그대로 쓴다 — 칸을 **새로 세울 때만**.
   * ⚠️ 앵커가 없는 보강(반별 발송 대상이 아닌 과목·학원)은 종전대로 보이지 않는 보강 반(`ensureMakeupAttendanceForReport`)에 앉는다.
   * 🔴 **귀속은 저장자가 아니라 보고서의 소유자**(저장된 행의 `created_by` → `teacher_name`, `pickMakeupOwner`) — 사무실 대리 저장 예방.
   */
  if (isMakeupRow) {
    const owner = await resolveMakeupOwner({
      tenantId: user.tenantId,
      createdBy: (data.created_by as string | null | undefined) ?? null,
      teacherName: data.teacher_name ?? null,
      saver: { id: user.id, name: user.displayName ?? null },
    }).catch(() => null);
    if (makeupAnchor) {
      const fin = await finishMakeupAnchor(supabase, {
        tenantId: user.tenantId,
        reportId: data.id,
        studentId: input.studentId,
        date: reportDate,
        subject: input.subject || LEGACY_REPORT_SUBJECT,
        anchor: makeupAnchor,
        priorAnchor,
        move: anchorMove,
        ownerId: owner?.id ?? null,
        via: "report_save",
      });
      if (!fin.ok)
        return {
          ok: false,
          id: data.id,
          shareToken: data.share_token,
          makeupClassId: anchorMove ? priorAnchor : makeupAnchor,
          error: fin.error,
        };
      makeupEffect = fin.makeupEffect;
    } else if (owner) {
      try {
        const placed = await ensureMakeupAttendanceForReport({
          tenantId: user.tenantId,
          teacherId: owner.id,
          teacherName: owner.name,
          studentId: input.studentId,
          subject: input.subject || LEGACY_REPORT_SUBJECT,
          date: reportDate,
        });
        // 그날 **보강 예약의 반**에 앉혔으면 그 반이 곧 이 보강의 반이다 — 보고서에도 적는다(보고서 반 = 출석부 반, 원장 2026-09-30).
        // 조건부(아직 비어 있을 때만) — 그새 누가 반을 정했으면 덮지 않는다.
        if (placed.reserved && placed.classId)
          await createAdminClient()
            .from("lesson_reports")
            .update({ makeup_class_id: placed.classId })
            .eq("tenant_id", user.tenantId)
            .eq("id", data.id)
            .is("makeup_class_id", null);
      } catch {
        /* 앵커 없는 보강(보이지 않는 보강 반)의 칸 생성 실패는 종전대로 저장을 막지 않는다(로그는 헬퍼가 남긴다) */
      }
    }
  }

  // 동시 첫 저장 — 사전 조회 땐 줄이 없었는데(또는 값이 같았는데) 그새 다른 선생님이 먼저 썼다. DB 트리거(0336a)가 그 값을 지켰으면
  // 저장된 값이 보낸 값과 다르다 → 화면이 그 값으로 되돌리게 알린다. (트리거 적용 전엔 내 값이 들어가 같다 — 그 경합은 트리거만 막는다.)
  const raceKept =
    !keptVideoHw && videoHwReady && typeof input.videoHomework === "boolean" &&
    !!data.created_by && data.created_by !== user.id && (data.video_homework ?? null) !== input.videoHomework
      ? { kept: data.video_homework ?? null }
      : null;
  const keptVideoHwFinal = keptVideoHw ?? raceKept;
  // 마감도 같은 경합 — 적으려던 마감과 저장된 마감이 다르면 DB 트리거가 작성 선생님의 마감을 지킨 것이다. 그 값을 화면에 돌려준다(`kept` —
  // 화면이 저장값으로 맞추고 줄을 잠그며, 이 저장은 발송하지 않는다 — 내 화면이 말하던 마감으로 나가지 않게, 적대 재리뷰 2026-10-15).
  const raceDue: SavedVideoHomeworkDue | null =
    videoDueWrite && "video_homework_due" in data && !!data.created_by && data.created_by !== user.id
    && (data.video_homework_due ?? null) !== videoDueWrite.video_homework_due
      ? isCustomDue(reportDate, data.video_homework_due)
        ? { mode: "next", date: data.video_homework_due, kept: true }
        : { mode: "week", date: null, kept: true }
      : null;
  const videoDueFinal = raceDue ?? videoDueSaved;

  /**
   * 감사로그 — **누가 이 보고서를 고쳤나**의 유일한 근거다.
   * 🔴 `lesson_reports`에는 `updated_by`가 없고, `created_by`는 갱신 때 DB 트리거가 **원 작성자를
   *    보존**한다(위 upsert 주석). 즉 사무실이 남의 보고서를 고쳐도 행에는 흔적이 안 남는다.
   * ⚠️ 본문(notes)·특이사항은 **담지 않는다** — 학생 사적 내용이고, id·날짜·반이면 그 행을 되짚는다.
   * ⚠️ 발송(`saveAndQueueClassnote`)은 이 함수를 그대로 거치므로 저장 1줄 + 발송 1줄이 남는다
   *    (같은 보고서 id로 이어 읽힌다 — 발송이 내용까지 바꿨다는 사실이 저장 줄에 남아야 한다).
   */
  // 저장한 일일·확인 칸이 오늘 수학 결과와 같은 값이면 기록에 남긴다(출처 추적 · 채우기 토글이 꺼진 학원은 조회 없음).
  const todaysMathSame = await todaysMathSamePromise;
  await logAction({
    action: "lesson_report_save",
    targetType: "lesson_report",
    metadata: {
      reportId: data.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject || null,
      classId: input.classId || null,
      via: "teacher",
      created: !priorRow,
      ...(input.makeup ? { makeup: true } : {}),
      ...(isMakeupRow ? { makeupClassId: makeupAnchor } : {}),
      // 작성 선생님이 아니라 영상 과제 값을 두었다(바꾸려던 값은 적지 않았다) · 장부에서 취소된 숙제라 '없음'을 지켰다.
      ...(keptVideoHwFinal ? { videoHomeworkKept: true } : {}),
      ...(cancelKept ? { videoHomeworkCancelled: true } : {}),
      ...(todaysMathSame.length ? { todaysMathSame } : {}),
    },
  });

  // `warning`은 영어 그림 자료 전용이다(일괄 저장이 그 건수로 센다) — 영상 과제를 둔 사실은 keptVideoHomework로만 알린다.
  const warning = jjCapture ? await jjCapture : null;
  return {
    ok: true,
    id: data.id,
    shareToken: data.share_token,
    makeupClassId: makeupAnchor,
    ...(warning ? { warning } : {}),
    ...(keptVideoHwFinal ? { keptVideoHomework: keptVideoHwFinal.kept } : {}),
    // 장부에서 취소된 숙제라 '없음'을 지켰다 — 화면은 값을 되돌리고 그 줄의 맞춘 시각을 이 응답 시각으로 옮긴다(다시 켜면 받는다).
    ...(cancelKept ? { videoHomeworkCancelled: true, videoHomeworkSeenAt: new Date().toISOString() } : {}),
    ...(videoDueFinal ? { videoHomeworkDue: videoDueFinal } : {}),
    ...(makeupEffect ? { makeupEffect } : {}),
    mentSource: mentSourceFinal,
  };
}

/**
 * 원스크린 "ClassNote 발송" — 보고서 저장(upsert) + ClassNote 큐 적재를 한 액션으로.
 * 강사는 큐에 넣고 즉시 반환(비동기) — 실제 게시는 로컬 워커가 폴링해 처리(P3).
 *
 * 재발송 정책(2026-07-22 원장 확정 "다시 보낼 일이 없다"): **저장 전** 기존 상태를 확인한다.
 * - `processing`(워커가 게시 중) → 내용을 덮어쓰지 않고 반환(레이스·오게시 방지).
 * - `success`(이미 학부모 게시판에 올라감) → **차단**. ClassNote는 게시글 수정·삭제가 없어 재발송 =
 *   글이 하나 더 붙는 것뿐이고 되돌릴 수단이 없다. 저장도 하지 않는다 — 여기서 내용만 갱신하면
 *   DB와 학부모가 실제로 본 글이 갈라진다(내용 수정은 '저장' 버튼으로, 그건 발송과 무관).
 *   ⚠️ 탈출구는 둘 다 사람이 명시적으로 여는 경로다: ① 공유링크 **재발급**(reissueShareLink가 상태를
 *   리셋 → 다시 발송 가능) ② 관리자 발송 콘솔의 '재발송'(retryClassnote). 이 함수에 force 인자를
 *   더하지 말 것 — 강사 화면의 실수 클릭을 막는 게 이 가드의 전부다.
 * - 그 외(null/queued/failed/too_old/name_conflict) → upsert 후 `queued`로 적재.
 */
export async function saveAndQueueClassnote(
  input: SaveLessonReportInput,
): Promise<{
  ok: boolean;
  id?: string;
  shareToken?: string;
  status?: string;
  error?: string;
  /** 발송 허용 시간창 밖에 큐잉됨 — "HH:MM~HH:MM"(창 라벨). 워커가 창 진입 시 자동 발송(강사 안내용). */
  sendWindowHint?: string;
  /** 저장 단계의 알림(영어 그림 자료를 못 묶음 — saveLessonReport `warning` 그대로). */
  warning?: string;
  /** 저장 단계에서 영상 과제 값을 작성 선생님 것으로 두었다(saveLessonReport 그대로) — 화면이 이 값으로 되돌린다. */
  keptVideoHomework?: boolean | null;
  /** 저장 단계에서 장부 취소를 지켰다(saveLessonReport 그대로) — 이 줄은 보내지 않았다. */
  videoHomeworkCancelled?: true;
  videoHomeworkSeenAt?: string;
  /** 저장 단계가 적은 영상 숙제 마감(saveLessonReport 그대로) — 화면이 '다음 수업' 날짜를 싣는다. */
  videoHomeworkDue?: SavedVideoHomeworkDue;
  /** 저장 단계의 보강 기록 반영 알림(saveLessonReport `makeupEffect` 그대로) — 발송 결과와 무관하게 알린다. */
  makeupEffect?: MakeupEffectNotice;
  /** status="needs_class"일 때 — 고를 수 있는 반(반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'). */
  candidates?: { id: string; name: string }[];
  /** status="needs_class"일 때 — 처음 골라 둘 반(메인 수업). */
  defaultClassId?: string | null;
  /** status="needs_class"일 때 — 보강 추가한 반인데 이 학생의 반 보드가 없어 다른 반으로 가야 한다(경고 한 줄). */
  makeupClassName?: string | null;
  /** status="board_hold"·"board_hold_recheck"일 때 — 반 보드 배정이 보류된 사유 문장(강사뷰 사전의 `{reason}`). */
  boardHoldReason?: string;
}> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 발송(외부 발신)은 특히 이중으로 막는다(saveLessonReport 내부 가드와 별개).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };

  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };

  const supabase = await createClient();
  // 대상 날짜 = 고른 날짜 클램프(saveLessonReport와 동일 계산 → pre-read·too_old 게이트가 그 날짜 기준).
  const reportDate = resolveReportDate(input.reportDate);

  // 저장 전 상태 pre-read — **행(반) 단위**(0134a). 반이 있으면 그 반 행, 없으면 반 없는 같은 과목 행.
  // ⚠️ 예전엔 (student,date,subject)로 maybeSingle이었다. 같은 과목 두 반(정규+특강)이 생기면
  //    2행이 걸려 maybeSingle이 에러를 던지고 발송 전체가 "실패"로 죽는다.
  const base = supabase
    .from("lesson_reports")
    .select("id, classnote_status, revoked_at")
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate);
  const scoped = input.classId
    ? base.eq("class_id", input.classId)
    : input.subject
      ? base.is("class_id", null).eq("subject", input.subject)
      : base.is("class_id", null).is("subject", null);
  const { data: priorRows } = await scoped.limit(1);
  const prior = priorRows?.[0];
  // 🔴 회수 처리 중 — 워커가 옛 게시글을 아직 안 지웠다. 지금 보내면 **옛 글 옆에 새 글이 하나 더** 붙고,
  //    새 토큰을 내면 워커가 지울 글을 못 찾아 **고아 게시글**이 된다. 삭제가 끝난 뒤에만 보낸다.
  if (isRecallInFlight((prior?.classnote_status as string | null) ?? null)) {
    return { ok: true, id: prior!.id, status: "recall_pending" };
  }
  // 🔴 **회수 완료분의 재발송 = 그냥 '발송'**(원장 2026-08-06: *"회수하고 클래스노트 발송 버튼 누르면
  //    그게 재발송 아닌가"*). 별도 '재발송' 버튼을 두지 않는다. 옛 글은 이미 지워졌고 옛 링크는 죽었으니
  //    **새 토큰**을 내고 취소를 풀어 평범한 첫 발송과 같은 상태로 되돌린 뒤 아래 정상 경로를 탄다.
  //    ⚠️ 되돌리는 건 여기(사람이 발송을 누른 시점)뿐이다 — 회수 직후 자동으로 되돌리면 그 행이
  //    '미발송'이 되어 **관리자 일괄 발송**(isAdminSendable = 상태 없음)에 딸려 들어간다. 잘못돼서
  //    거둬들인 내용이 다음 일괄 발송에 그대로 다시 나가는 사고가 된다.
  if (prior?.classnote_status === "recalled") {
    await supabase
      .from("lesson_reports")
      .update({
        share_token: randomUUID(),
        revoked_at: null,
        revoked_by: null,
        classnote_status: null,
        classnote_error: null,
        classnote_sent_at: null,
        classnote_queued_at: null,
        classnote_processing_at: null,
        classnote_retry_count: 0,
      })
      .eq("id", prior.id)
      .eq("classnote_status", "recalled"); // 동시 클릭 경합 — 한 번만 되돌린다
  } else if (prior?.revoked_at) {
    // 취소된 링크(회수와 무관 — 링크만 막은 건)는 재큐잉 안 함. 재발급으로 새 토큰을 내야 한다.
    return { ok: true, id: prior.id, status: "revoked" };
  }
  // 워커 게시 중이면 내용 덮어쓰지 않고 그대로 반환(in-flight 보호).
  if (prior?.classnote_status === "processing") {
    return { ok: true, id: prior.id, status: "processing" };
  }
  // 이미 게시된 건은 재발송하지 않는다(중복 게시 차단, 위 주석 참조). 저장도 건너뛴다.
  if (prior?.classnote_status === "success") {
    return { ok: true, id: prior.id, status: "already_sent" };
  }

  // 저장(upsert) — 권한 재검증(getCurrentUser+담당 활성수강생)은 saveLessonReport 내부.
  const saved = await saveLessonReport(input);
  // 반 미정 보강(원장 2026-09-30) — 저장이 막혔다. 보낼 수 있는 반을 후보로 돌려주면 화면이 고르게 하고, 고른 반을 보강 반으로
  // 실어 다시 보낸다(그 저장이 출석부 칸을 그 반에 세운다). 후보 조회 실패는 저장 오류 문장 그대로.
  if (!saved.ok && saved.needsAnchor) {
    const pick = await resolveMakeupSendClass(user.tenantId, input.studentId, reportDate, input.subject, null).catch(() => null);
    if (pick && !pick.ok && pick.reason === "choose")
      return {
        ok: false,
        ...(saved.id ? { id: saved.id } : {}),
        status: "needs_class",
        candidates: pick.candidates,
        defaultClassId: pick.defaultId,
        makeupClassName: null,
        error: saved.error,
      };
    return { ok: false, status: pick && !pick.ok ? "no_class" : undefined, error: pick && !pick.ok ? NO_SEND_CLASS_ERROR : saved.error };
  }
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };
  // 저장 단계 알림(영어 그림 자료 · 영상 과제 값을 둠) — 아래 어느 결과로 끝나든 함께 돌려준다(저장은 이미 끝났다).
  const warn = {
    ...(saved.warning ? { warning: saved.warning } : {}),
    ...(saved.keptVideoHomework !== undefined ? { keptVideoHomework: saved.keptVideoHomework } : {}),
    ...(saved.videoHomeworkCancelled ? { videoHomeworkCancelled: saved.videoHomeworkCancelled, videoHomeworkSeenAt: saved.videoHomeworkSeenAt } : {}),
    ...(saved.videoHomeworkDue ? { videoHomeworkDue: saved.videoHomeworkDue } : {}),
    ...(saved.makeupEffect ? { makeupEffect: saved.makeupEffect } : {}),
  };
  // 🔴 영상 숙제 마감이 고른 것과 다르게 됐다(다음 수업을 못 찾음·이미 지남·시간표를 못 읽음 → 7일 · 남이 쓴 줄이라 그대로 둠) — 멘트·미리보기가
  //    말한 마감과 학부모 카드의 마감이 갈린 채 나가지 않게 이 줄은 보내지 않는다(저장은 끝났다 — 화면이 마감을 고친 걸 보고 다시 보낸다, 적대 리뷰 M2).
  // 장부에서 취소된 숙제라 '없음'을 지켰다(원장 2026-10-16) — 멘트·미리보기가 영상 숙제를 말하고 있을 수 있어 같은 길로 보내지 않는다.
  if (saved.videoHomeworkCancelled || saved.videoHomeworkDue?.fellBack || saved.videoHomeworkDue?.kept) {
    // 대기 중(queued) 재고 회수 — 옆 게이트들과 같은 이유: 안 지우면 "보내지 않았습니다" 안내 직후 워커가 옛 대기분을 게시한다.
    if (prior?.classnote_status === "queued") {
      try {
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
      } catch {
        // best-effort — 어차피 에러 반환이라 강사 재시도가 뒤따른다(옆 게이트와 같다)
      }
    }
    return { ok: false, id: saved.id, shareToken: saved.shareToken, ...warn,
      error: saved.videoHomeworkCancelled ? VIDEO_HW_CANCELLED_ERROR : VIDEO_DUE_CHANGED_ERROR };
  }
  // 🔴 글에 적힌 영상 숙제 마감 ↔ 이번 저장이 정한 마감(원장 2026-10-28) — 글의 날짜만 고친 줄은 학부모가 읽는 마감과 사이트·미수행 판정이
  //    갈린다(10/27 실측 12건). 화면(sendRow)도 막지만 한 겹이다(#77). 마감을 이번 저장이 정했을 때만 본다(모르면 막을 근거가 없다).
  if (input.videoHomework === true && saved.videoHomeworkDue) {
    const dueGap = videoDueTextMismatch(input.notes, expectedVideoDue(reportDate, saved.videoHomeworkDue.mode, saved.videoHomeworkDue.date));
    if (dueGap) {
      if (prior?.classnote_status === "queued") {
        try {
          await supabase
            .from("lesson_reports")
            .update({ classnote_status: null, classnote_queued_at: null })
            .eq("id", saved.id)
            .eq("classnote_status", "queued");
        } catch {
          // best-effort — 옆 게이트와 같다
        }
      }
      return { ok: false, id: saved.id, shareToken: saved.shareToken, ...warn, error: VIDEO_DUE_TEXT_MISMATCH_ERROR };
    }
  }

  // 🔴 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) — '자동작성' 글 그대로가 아니면 보내지 않는다(저장은 끝났다).
  //    화면은 멘트 칸을 잠그고 발송 버튼도 막지만 그건 한 겹이다(#77) — 서버는 저장된 작성 방식(0214a, sticky 판정)으로 다시 본다.
  //    작성 방식을 모르면(컬럼 없음) 보내지 않는다 — 시범 한 명이라 막는 쪽이 싸다.
  // 강사 한줄 멘트(필수, 원장 2026-10-22) — 비었거나 글 끝에 안 붙었으면 같은 길로 거절한다(안 싣는 옛 경로도 막힌다).
  const pilotRow = isMathReportPilot(input.studentId, input.subject);
  const pilotBlock = !pilotRow
    ? // 영어 — '사랑의 한마디' 필수(원장 2026-10-26). 영어 글은 템플릿이라 끝에 붙었는지는 보지 않고 적었는지만 본다.
      input.subject === "english" && !input.jjSheet && !(input.pilotOneLine ?? "").trim()
      ? ENGLISH_ONELINE_REQUIRED_ERROR
      : // 영어 사유 조건(화면이 판정해 싣는다) — 보강 사유는 2026-10-27부터 조건이 아니라 지금은 해당 없음(옛 화면 탭만 false를 싣는다).
        input.subject === "english" && input.pilotCheck && !input.pilotCheck.reasonsOk
        ? PILOT_REASON_REQUIRED_ERROR
        : null
    : saved.mentSource !== "auto" && saved.mentSource !== "auto_edited" // 자동작성 뒤 고친 글도 보낸다(2026-10-23)
      ? PILOT_AUTOWRITE_REQUIRED_ERROR
      : !input.pilotCheck?.factsCurrent // 자동작성 뒤 출결·점수·태도 등이 바뀌었다(옛 값이 적힌 글) — 2026-10-26
        ? PILOT_AUTOWRITE_REQUIRED_ERROR
        : !input.pilotCheck.reasonsOk // 시험 없음·숙제 미제출 사유가 비었다 — 2026-10-26
          ? PILOT_REASON_REQUIRED_ERROR
          : !pilotOneLineAttached(input.notes, input.pilotOneLine)
            ? PILOT_ONELINE_REQUIRED_ERROR
            : null;
  if (pilotBlock) {
    if (prior?.classnote_status === "queued") {
      try {
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
      } catch {
        // best-effort — 어차피 에러 반환이라 강사 재시도가 뒤따른다(옆 게이트와 같다)
      }
    }
    return { ok: false, id: saved.id, shareToken: saved.shareToken, ...warn, error: pilotBlock };
  }

  // 🔴 보강 진행 여부 확인(원장 2026-10-27 *"보강체크를 하지 않으면 보고서 발송 비활성화"*) — 보강이 든 보고서(정규+보강 · 보강 줄)는
  //    그 반 그날 보강 예약을 선생님이 '보강 했음'으로 확인(0458a `checked_at`)해야 보낸다. 화면 게이트(`needsMakeupCheck`)와 같은 판정의
  //    서버 겹(#77 — 일괄 발송·옛 화면). 정규 줄은 분리 예약(따로 선 보강 줄의 몫)을 보지 않는다.
  if (
    input.makeup &&
    (await makeupCheckPending({
      tenantId: user.tenantId,
      studentId: input.studentId,
      date: reportDate,
      classId: input.classId ?? null,
      makeupClassId: saved.makeupClassId ?? input.makeupClassId ?? null,
    }))
  ) {
    if (prior?.classnote_status === "queued") {
      try {
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
      } catch {
        // best-effort — 어차피 에러 반환이라 강사 재시도가 뒤따른다(옆 게이트와 같다)
      }
    }
    return { ok: false, id: saved.id, shareToken: saved.shareToken, ...warn, error: MAKEUP_CHECK_REQUIRED_ERROR };
  }

  // 발송 안전 스위치 — 기본 OFF(dry-run). 원장이 승인(설정 토글)하기 전까지 **저장만** 하고 실제 큐잉(발송) 안 함.
  // 공유 DB + 라이브 워커라 승인 전 실발송 방지(classnote_status 미변경 → 워커가 안 잡음).
  const settings = await getTenantSettings();
  if (!classnoteSendOn(settings)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "dry_run", ...warn };
  }

  // 과목별 발송 게이트 — 학원설정 발송 허용 과목(현 운영=수학만)에 없으면 저장만 하고 큐잉 안 함(오발송 방지).
  if (!isClassnoteSubjectEnabled(input.subject, settings.report.classnoteSubjects)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "subject_off", ...warn };
  }

  // 🔴 영어 글이 그림 자리 줄뿐이면(글자 0) 큐에 올리지 않는다 — 저장은 이미 됐고 **발송만** 막는다(jj-capture-plan.ts).
  if (isSlotOnlyEnglishNotes(input.subject, input.notes)) {
    // 대기 중(queued) 재고 회수 — 옆 게이트들과 **같은 이유**: 안 지우면 "보내지 않았습니다" 안내 직후 워커가 자리 줄뿐인
    // 카드를 게시한다(적대 재리뷰 2026-09-11). `.eq queued` 조건 = 그새 클레임된 processing은 건드리지 않는다.
    if (prior?.classnote_status === "queued") {
      try {
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
      } catch {
        // best-effort — 어차피 에러 반환이라 강사 재시도가 뒤따른다(옆 게이트와 같다)
      }
    }
    return {
      ok: false,
      // 저장은 됐다 — id·공유 링크를 함께 돌려줘 화면이 '저장 안 됨'으로 보이지 않게(적대 재리뷰).
      id: saved.id,
      shareToken: saved.shareToken,
      error: "글이 그림·첨부 자리뿐이라 보내지 않았습니다(저장은 됐습니다) — 글을 채운 뒤 다시 보내 주세요",
      ...warn,
    };
  }

  // 🔴 '수업보고서 미발송' 반(0174a) 게이트 — **저장은 하고 큐잉만 막는다**(2026-08-19).
  //    2026-08-19부터 이 반이 원스크린 로스터에 **돌아왔다**(출결을 찍어야 해서). 화면은 발송 버튼을
  //    잠그지만 그건 한 겹이라 stale 화면·직접 호출로 우회된다(#77) — 관리자 일괄 발송(compose-actions)이
  //    이미 서버에서 다시 거르는 것과 **같은 축**의 강사 경로 방어다.
  //    ⚠️ 저장을 막지 않는 이유는 report-optout.ts가 못 박아 둔 규약이다("숨김이지 차단이 아니다" —
  //       막으면 그 반의 지난 보고서 수정 경로까지 잠긴다). 여기서 막는 것은 **학부모 발송**뿐이다.
  //    ⚠️ 반이 없는 행(보강·수업외·이관분)은 판정 근거가 없어 대상이 아니다(결석 게이트와 같은 예외).
  //    ⚠️ 왕복 1회(PK 단건 조회)이고 **발송 경로에서만** 돈다 — 페이지 렌더에는 안 얹힌다.
  if (input.classId) {
    const { data: klassRow, error: klassErr } = await supabase
      .from("classes")
      .select("report_optout")
      .eq("id", input.classId)
      .maybeSingle();
    // 조회 실패는 fail-open — 이 게이트는 "안 보내도 되는 반"을 거르는 것이지 안전장치가 아니고,
    // 여기서 막으면 조회가 흔들릴 때 **정상 반의 발송이 통째로 죽는다**(결석 게이트의 fail-closed와
    // 성격이 다르다: 저쪽은 틀리면 학부모에게 거짓이 나가지만 여기는 화면이 이미 한 겹 막고 있다).
    if (!klassErr && klassRow && isReportOptout(klassRow)) {
      // 대기 중(queued) 재고 회수 — 결석 게이트와 **같은 이유**: 안 지우면 "발송하지 않았습니다" 안내
      //    직후 워커가 방금 저장된 내용을 그대로 게시한다(반을 미발송으로 바꾸기 전에 큐에 올라간 건).
      //    `.eq queued` 조건이라 그새 클레임된 processing은 건드리지 않는다.
      if (prior?.classnote_status === "queued") {
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
      }
      return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "report_optout", ...warn };
    }
  }

  // 결석 게이트(#77) — 그날 그 과목 출결이 결석이면 저장만 하고 큐잉 안 함(학부모 발송 무의미).
  // 클라 게이트(grid.ts isRowActionable)와 동일 규약의 서버 이중 방어 — 버튼 disabled 우회·stale 화면 차단.
  // ⚠️ 보강 보고서(makeup 체크·수업외 수동추가)는 게이트 제외 — 정규 반 결석 + 같은 날 보강 참석이
  // 정당한 발송 흐름이고, 보강 강사에겐 그 학생 출결을 기록할 수단이 없다(적대 리뷰 확정).
  // 조회 실패 = fail-closed(모르면 안 보냄, 저장은 이미 완료) — 명확 안내 후 재시도 유도.
  if (!input.makeup && !input.outOfClass) {
    try {
      // 결석 판정과 출결 존재 판정은 서로 독립 쿼리 — 직렬 워터폴 금지(B4).
      const [absentBlocked, attendanceChecked] = await Promise.all([
        isStudentAbsentForSend(supabase, user.tenantId, {
          studentId: input.studentId,
          reportDate,
          subject: input.subject ?? null,
          // 반이 있으면 **그 반** 출결만 본다(0134a) — 특강 결석인데 정규 출석이라 통과하던 구멍을 막는다.
          classId: input.classId ?? null,
        }),
        // 출결 미체크 게이트(2026-08-17 원장 지시) — 출결 체크도 진도·멘트 같은 발송 필요 입력.
        // 클라 게이트(grid.ts isAttendanceUnchecked)와 동일 규약의 서버 이중 방어(버튼 우회·stale 화면 차단).
        // ⚠️ 결석 게이트의 fail-open(기록 없음=통과)은 그대로다 — 이 체크는 강사 경로 전용 별도 게이트
        //    (관리자 콘솔·재발송·미발송 재촉 이벤트는 안 걸린다, hasAnyAttendance 주석·#105 참조).
        // ⚠️ 반(classId) 있는 정규 행만 — 반 없는 행(이관·반 모호)은 어느 반 출결을 요구할지 정할 수 없다.
        // ⚠️ 출결 쓰기 권한이 없는 계정(attendance 메뉴 none)은 게이트 해당 없음(감사 P0-3) —
        //    충족할 수 없는 입력을 요구하면 그 계정의 발송이 영구 차단된다. 클라(isRowActionable
        //    attendanceReadOnly)와 같은 예외이고, 판정 헬퍼도 roster canEditAttendance와 동일하다.
        input.classId
          ? canWriteTenant(user.systemRole, "attendance").then((can) =>
              can
                ? hasAnyAttendance(supabase, user.tenantId, {
                    studentId: input.studentId,
                    classId: input.classId!,
                    date: reportDate,
                  })
                : true,
            )
          : Promise.resolve(true),
      ]);
      if (absentBlocked || !attendanceChecked) {
        // 대기 중(queued) 재고 회수 — 안 지우면 "발송하지 않았습니다" 안내 직후 워커가 방금 갱신된
        // 내용을 그대로 게시한다(적대 리뷰 확정). .eq queued 조건 = 그새 클레임된 processing은 불변.
        if (prior?.classnote_status === "queued") {
          await supabase
            .from("lesson_reports")
            .update({ classnote_status: null, classnote_queued_at: null })
            .eq("id", saved.id)
            .eq("classnote_status", "queued");
        }
        // 결석이 미체크보다 우선 — 기록이 있는데 결석인 행에 "출결 체크하라"는 안내는 거짓이다.
        return {
          ok: true,
          id: saved.id,
          shareToken: saved.shareToken,
          status: absentBlocked ? "absent" : "no_attendance",
          ...warn,
        };
      }
    } catch {
      // fail-closed 마무리 — 판정을 모르면 **대기 중(queued) 재고도 회수**한다. 안 지우면 "발송하지
      // 않았습니다" 안내 직후 워커가 방금 저장된 내용을 그대로 게시한다(적대 리뷰 확정 — 차단 분기만
      // 회수하던 기존 구멍). 회수 자체의 실패는 무시 — 어차피 에러 반환이라 강사 재시도가 뒤따른다.
      if (prior?.classnote_status === "queued") {
        try {
          await supabase
            .from("lesson_reports")
            .update({ classnote_status: null, classnote_queued_at: null })
            .eq("id", saved.id)
            .eq("classnote_status", "queued");
        } catch {
          // best-effort — 위 주석 참조
        }
      }
      return { ok: false, error: "출결 확인에 실패해 발송하지 않았습니다 — 저장은 완료됐어요. 다시 시도해 주세요", ...warn };
    }
  }

  // 동명이인 감지 — ClassNote 이름 매칭이 첫 일치라 오발송 위험 → 자동 발송 차단(보고서 저장은 유지, 큐잉만 막음).
  // 강사가 학생 이름을 구분(예: "김민수(중2)")하거나 수동 확인 후 다시 시도. 워커는 'queued'만 잡아 name_conflict는 미처리.
  if (await hasClassnoteNameCollision(supabase, input.studentId)) {
    await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "name_conflict",
        classnote_queued_at: null,
        classnote_error: "동명이인 감지 — 자동 발송 차단",
      })
      .eq("id", saved.id)
      // 그새 워커가 집었거나 보낸 행은 덮지 않는다(아래 적재와 같은 조건부 — 보낸 글을 '차단됨'으로 거짓 표시하지 않게).
      .or(CLASSNOTE_REQUEUE_OK);
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "name_conflict", ...warn };
  }

  /**
   * 반별 발송(ClassNote 모듈 켜짐 · 수학은 늘 반별 — 옛 '수학 발송 경로' 설정은 2026-11-05에 없앰) — 🔴 원장 2026-09-30: **보고서 반 = 출석부 반 = 발송 반**.
   *  · 정규 보고서 = 보고서 반의 반 보드로만. 이 학생이 받을 반 보드가 없으면 **막고 안내**한다 — 다른 반으로 보내지 않는다
   *    (원장 결정 4 · 반 보드 동기화가 필요하다). 예전엔 다른 반을 고르게 했다(C5).
   *  · 보강 보고서 = **보강 반**(저장이 확인해 적은 `makeup_class_id`)의 반 보드로만. 보드가 없으면 반을 고르게 하고, 고른 반은
   *    다시 저장을 지나 **새 보강 반**이 된다(출석부 칸도 함께 옮겨진다). '보낼 반'만 따로 적는 길은 없앴다(C1·C9).
   *  · 반 정보가 없는 정규 행(옛 과목 단위 행)은 반별로 보낼 곳이 없다 — 막는다.
   * 🔴 확인 실패는 **발송하지 않는다**(fail-closed) — 모르는 채로 보내면 워커가 막거나 엉뚱한 곳을 시도한다.
   */
  const routeApplies = classRouteActive(settings, user.displayName); // ClassNote 모듈이 꺼진 학원은 언제나 false(예전 그대로)
  let sendClassPick: { classId: string; via: string } | null = null; // 감사로그 — 어느 반으로
  if (routeApplies && SEND_CLASS_SUBJECTS.has(input.subject ?? "")) {
    const unqueue = async () => {
      if (prior?.classnote_status === "queued")
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
    };
    // 화면 글자는 status로 강사뷰 사전(os.c.*)을 탄다 — error는 한국어 폴백.
    const checkFail = {
      ok: false,
      id: saved.id,
      shareToken: saved.shareToken,
      status: "class_check_failed",
      error: "보낼 반을 확인하지 못해 발송하지 않았습니다 — 저장은 됐습니다. 다시 시도해 주세요",
      ...warn,
    };
    if (input.classId) {
      const classLive = await classBoardLiveForStudent(user.tenantId, input.classId, input.studentId).catch(() => null);
      if (classLive === null) {
        await unqueue();
        return checkFail;
      }
      if (!classLive) {
        await unqueue();
        // 까닭을 가려 안내한다(방금 배정된 신입·배정 보류·반을 떠난 학생) — 기다리면 풀리는 까닭이면 그 반·학생의 동기화도 요청한다.
        const why = await explainBoardMissing(user.tenantId, input.classId, input.studentId, { request: true });
        return { ok: false, id: saved.id, shareToken: saved.shareToken, status: why.status, error: why.error, boardHoldReason: why.holdReason, ...warn };
      }
    } else if (!input.makeup) {
      await unqueue();
      return { ok: false, id: saved.id, shareToken: saved.shareToken, status: "no_class", error: NO_SEND_CLASS_ERROR, ...warn };
    } else {
      let pick: Awaited<ReturnType<typeof resolveMakeupSendClass>>;
      try {
        pick = await resolveMakeupSendClass(user.tenantId, input.studentId, reportDate, input.subject, saved.makeupClassId ?? null);
      } catch {
        await unqueue();
        return checkFail;
      }
      if (!pick.ok && pick.reason === "choose") {
        await unqueue();
        return {
          ok: false,
          id: saved.id,
          shareToken: saved.shareToken,
          status: "needs_class",
          candidates: pick.candidates,
          defaultClassId: pick.defaultId,
          makeupClassName: pick.makeupClass?.name || null,
          error: pick.makeupClass
            ? `보강 반(${pick.makeupClass.name || "이름 없음"})에 이 학생의 ClassNote 반 보드가 없습니다 — 보강 반을 바꿔 주세요(저장은 됐습니다)`
            : "보강 반을 골라 주세요 — 저장은 됐습니다",
          ...warn,
        };
      }
      // 🔴 후보가 없으면(이 학생의 반 보드가 있는 같은 과목 반이 없음) 발송 불가 — 저장은 그대로, 대기에 올리지 않는다.
      if (!pick.ok) {
        await unqueue();
        return { ok: false, id: saved.id, shareToken: saved.shareToken, status: "no_class", error: NO_SEND_CLASS_ERROR, ...warn };
      }
      // '보낼 반'(0303a)은 저장이 이미 보강 반으로 적었다(복사본) — 여기서 따로 적지 않는다.
      sendClassPick = { classId: pick.classId, via: pick.via };
    }
  }

  // 오늘 수학 월말평가 성적표(0373a) — 시험일 보고서를 저장하자마자 보내도 성적표가 함께 나가게 큐에 올리기 바로 앞에서 붙인다.
  // 토글이 꺼졌거나 그날 그 반 월말평가 결과가 없으면 색인 한 번(또는 0번)으로 끝 · 실패해도 발송은 그대로(최대 8초).
  if (input.classId) {
    await attachExamReportBeforeSend({
      tenantId: user.tenantId, studentId: input.studentId, classId: input.classId, reportDate,
      enabled: settings.report.todaysMathReportPdf,
    });
  }

  // too_old(전 달 1일 이전) 아니면 queued로 재적재(재발송). 오늘 저장은 항상 통과하나 규약상 명시.
  const allowed = isClassnoteAllowed(reportDate);
  // 🔴 **조건부 적재(compare-and-set)** — 맨 위의 processing·success 확인과 이 줄 사이에 워커가 첫 발송을 끝낼 수 있다.
  //    9/29 박세욱: 발송 → 첨부 추가 → 0.3초 뒤 다시 발송 — 그 틈에 워커가 첫 글을 올렸는데 이 update가 success를 덮고
  //    queued로 되돌려 **같은 글이 한 번 더** 올라갔다(ClassNote 글은 지울 수 없다). 그새 워커가 집었거나 보냈으면 0행.
  const { data: queuedRows, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: allowed ? "queued" : "too_old",
      classnote_queued_at: allowed ? new Date().toISOString() : null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .eq("id", saved.id)
    .or(CLASSNOTE_REQUEUE_OK)
    .select("id");
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송 요청"), ...warn };
  if (!queuedRows?.length) {
    // 그새 워커가 집었거나(processing) 이미 보냈다(success) — 다시 올리지 않는다. 화면은 그 상태를 그대로 보여 준다.
    const { data: now } = await supabase.from("lesson_reports").select("classnote_status").eq("id", saved.id).maybeSingle();
    const st = (now?.classnote_status as string | null) ?? null;
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: st === "processing" ? "processing" : "already_sent", ...warn };
  }
  /**
   * 🔴 **학부모에게 나가는 순간**이라 반드시 남긴다(ClassNote는 게시글 수정·삭제가 없어 되돌릴 수 없다).
   * ⚠️ 위 조기 반환들(dry_run·subject_off·report_optout·absent·no_attendance·already_sent·processing·
   *    revoked·recall_pending·name_conflict)은 **아무것도 안 나간 것**이라 여기 안 온다 —
   *    "발송 기록"이 실제 발송만 뜻하게 유지한다.
   * ⚠️ `too_old`도 큐에 안 올라가지만(워커가 안 집는다) 사람은 발송을 눌렀으므로 상태를 함께 남긴다.
   */
  await logAction({
    action: "classnote_send",
    targetType: "lesson_report",
    metadata: {
      reportId: saved.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject || null,
      classId: input.classId || null,
      via: "teacher",
      status: allowed ? "queued" : "too_old",
      ...(sendClassPick ? { sendClassId: sendClassPick.classId, sendClassVia: sendClassPick.via } : {}),
      // 회수했던 건을 다시 보낸 경우 — 위에서 공유 토큰을 새로 발급했다(옛 링크는 죽었다).
      ...(prior?.classnote_status === "recalled" ? { fromRecalled: true } : {}),
    },
  });
  // 발송 허용 시간창 밖이면 대기 안내(실제 지연은 워커 게이트 담당 — 여기선 문구만). 창 안·무제한 = undefined.
  const sendWindowHint =
    allowed
      ? (classnoteSendWindowHint(
          settings.report.classnoteSendWindowStart,
          settings.report.classnoteSendWindowEnd,
        ) ?? undefined)
      : undefined;
  return {
    ok: true,
    id: saved.id,
    shareToken: saved.shareToken,
    status: allowed ? "queued" : "too_old",
    sendWindowHint,
    ...warn,
  };
}

/**
 * 공유 링크 취소(revoke) — 강사가 학부모 공개 링크(/r/[token]) 열람을 즉시 차단(오발송 회수).
 * 링크·토큰은 유지하되 revoked_at을 세워 /r이 취소화면을 렌더. 대상은 share_token으로 식별(전역 유니크).
 */
export async function revokeShareLink(shareToken: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 발송 흔적(공유 링크)을 열람 중에 만지지 못하게.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!shareToken) return { ok: false, error: "링크 정보가 없습니다" };
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("lesson_reports")
    .select("id, student_id, report_date")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!report) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  // 담당 판정은 **그 보고서 날짜** 기준 — 임시 위임(0173a)은 기간이 있어 오늘로 보면 어제 위임분을 못 만진다.
  if (!(await teacherOwnsStudent(supabase, user.id, report.student_id, report.report_date as string)))
    return { ok: false, error: "담당 학생이 아닙니다" };
  const { error } = await supabase
    .from("lesson_reports")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", report.id);
  if (error) return { ok: false, error: humanizeDbError(error.message, "열람 차단") };
  // 🔴 학부모가 보던 링크를 **끄는** 동작 — 밖으로 나갔던 것을 되돌리는 일이라 흔적이 필수다.
  //    (행의 `revoked_by`가 남긴 하지만 재발급 한 번에 지워진다 — 아래 reissue가 null로 되돌린다.)
  await logAction({
    action: "share_link_revoke",
    targetType: "lesson_report",
    metadata: {
      reportId: report.id,
      studentId: report.student_id,
      date: report.report_date,
    },
  });
  return { ok: true };
}

/**
 * 공유 링크 재발급(reissue) — 새 토큰 발급 → 옛 토큰은 전역 유니크라 /r에서 자동 404(유출 대응·완전 교체).
 * 취소(revoked_*) 해제로 재활성화하고 ClassNote 상태도 리셋 — 이미 게시된 옛 링크는 死링크라 미발송 상태로
 * 되돌려 재발송을 유도(안 그러면 success로 남아 死링크가 ClassNote 게시글에 방치됨).
 */
export async function reissueShareLink(
  shareToken: string,
): Promise<{ ok: boolean; shareToken?: string; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — revokeShareLink와 동일.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!shareToken) return { ok: false, error: "링크 정보가 없습니다" };
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("lesson_reports")
    .select("id, student_id, report_date, classnote_status")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!report) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  // 담당 판정은 **그 보고서 날짜** 기준 — 임시 위임(0173a)은 기간이 있어 오늘로 보면 어제 위임분을 못 만진다.
  if (!(await teacherOwnsStudent(supabase, user.id, report.student_id, report.report_date as string)))
    return { ok: false, error: "담당 학생이 아닙니다" };
  // 🔴 회수 진행 중엔 재발급을 막는다 — **재발급은 share_token을 갈아치우는데, 그 토큰이 회수 워커가
  //    ClassNote 게시글을 찾는 유일한 키**다(본문 완전 일치). 여기서 토큰이 바뀌면 워커가 글을 영영 못 찾아
  //    학부모 게시판에 **지울 수 없는 고아 게시글**이 남는다(죽은 링크 + 스크린샷 이미지).
  //    회수가 끝난 뒤(recalled)엔 정상적으로 재발급할 수 있다.
  if (isRecallInFlight((report.classnote_status as string | null) ?? null))
    return { ok: false, error: "회수 처리 중입니다 — 게시글 삭제가 끝난 뒤에 재발급하세요" };
  const newToken = randomUUID(); // ⚠️ supabase-js update엔 SQL gen_random_uuid()를 못 씀 → Node에서 생성
  const { error } = await supabase
    .from("lesson_reports")
    .update({
      share_token: newToken,
      revoked_at: null,
      revoked_by: null,
      classnote_status: null,
      classnote_error: null,
      classnote_queued_at: null,
      classnote_processing_at: null,
      classnote_sent_at: null,
      classnote_retry_count: 0,
    })
    .eq("id", report.id);
  if (error) return { ok: false, error: humanizeDbError(error.message, "재발급") };
  /**
   * 🔴 재발급은 **옛 링크를 죽이고 발송 상태를 지운다** — 학부모가 갖고 있던 주소가 404가 되고,
   *    발송 완료였던 건이 '미발송'으로 돌아가 재발송이 열린다(수정 금지를 푸는 유일한 문).
   *    행에는 그 사실이 남지 않으므로(전부 null로 리셋) 이 줄이 유일한 근거다.
   */
  await logAction({
    action: "share_link_reissue",
    targetType: "lesson_report",
    metadata: {
      reportId: report.id,
      studentId: report.student_id,
      date: report.report_date,
      // 되돌린 발송 상태 — 'success'였다면 학부모에게 이미 나간 건을 다시 열었다는 뜻이다.
      prevStatus: (report.classnote_status as string | null) ?? null,
    },
  });
  return { ok: true, shareToken: newToken };
}

export type SaveOnescreenSessionInput = {
  studentId: string;
  outOfClass?: boolean;
  sessionDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 작업분을 그 날짜 세션에 저장(report_date와 동일 기준).
  classId?: string | null;
  studyGrade?: string | null;
  subjectProgress?: Record<
    string,
    {
      today?: string;
      /** 오늘 수업 성격(복습·문제풀이) — 진도 차시와 별개 축(progress-mode.ts). 빈 문자열=해제. */
      mode?: string;
      draft?: string;
      trendDraft?: string;
      /**
       * 자동작성이 멘트 칸에 마지막으로 넣은 텍스트(0214a 판정 스냅샷) — 세션에 실어야 새로고침·재접속
       * 뒤에도 "이 멘트는 AI에서 출발했다"를 안다(안 실으면 복원 후 저장이 전부 manual로 오표기 = 코퍼스 오염).
       */
      autoDraft?: string;
      /** 자동작성이 추세 칸에 마지막으로 넣은 글 — 새로고침 뒤에도 '달라진 것 없음'이 낡은 AI 추세를 지울 수 있게(2026-10-16). */
      trendAutoDraft?: string;
      /** autoDraft가 AI 원문이 아니다(실패 폴백 템플릿·지난 회차 복사) — 자동작성 원문(0370a)으로 싣지 않는다. */
      autoDraftTemplate?: boolean;
      textbook?: string;
      makeup?: boolean;
      homeworkToday?: string;
      /** 오늘 영상 과제 있음(0308a) — 새로고침 뒤에도 켠 표시가 남게 세션에도 싣는다(로스터가 같은 키로 복원). */
      videoHomework?: boolean;
      /** 영상 첨부 링크 넣기(0328a) — 같은 이유로 세션에도 싣는다(로스터가 같은 키로 복원). */
      videoSubmitLink?: boolean;
      /** 영상 숙제 마감(원장 2026-10-15) — 고른 값만(날짜는 서버가 정해 보고서에 남는다). 로스터가 같은 키로 복원한다. */
      videoHomeworkDue?: "week" | "next";
      /**
       * 영어 템플릿 모드(2026-09-10) — 고른 템플릿 · 다음 시간 테스트 · 마지막 AI 인사말/코멘트.
       * **영어 행만** 싣는다(수학 세션 모양 불변). 로스터 복원(roster.ts `OnescreenSessionRow`)이 같은 키를 읽는다.
       */
      templateId?: string;
      nextTest?: string;
      aiIntro?: string;
      aiComment?: string;
      /** 템플릿 글 지문 · AI 사실 지문(provenance.ts) — 영어 행만. */
      templateHash?: string;
      aiFactsHash?: string;
      composedFactsHash?: string;
      /**
       * 행(수업) 단위 평가값(2026-08-13) — 있는 행만 독립 값을 갖고, 없으면 아래 학생 단위 컬럼으로
       * 폴백한다(row-fields.ts). 보강은 정규와 따로 나가는 다른 보고서라 값이 겹치면 안 된다.
       * ⚠️ 이 객체는 검증 없이 `subject_progress` jsonb에 그대로 들어간다 — 새 키를 더할 땐
       *    로스터 복원(roster.ts)의 타입도 함께 넓힐 것(한쪽만 넓히면 조용히 안 읽힌다).
       */
      attitude?: string | null;
      homework?: string;
      note?: string;
      dailyScore?: number | null;
      dailyMax?: number;
      checkScore?: number | null;
      checkMax?: number;
      /** 소단원별 이해도(수학 보고서 시범, math-report-pilot.ts) — 시범 행만 싣는다. 로스터가 같은 키로 복원한다. */
      understanding?: { scores: Record<string, number>; off: string[] };
      /** 일일 테스트 '없음' 사유(수학 보고서 시범) — 시범 행만 싣는다. 로스터가 readTestSkip으로 복원한다. null = 시험 있음. */
      dailyTestSkip?: { reason: string | null; detail: string } | null;
      /** 숙제 미제출 사유(수학 보고서 시범) — 시범 행만 싣는다. 로스터가 readHomeworkMissReason으로 복원한다. */
      homeworkMissReason?: string;
      /** 수업 태도 의견(새 수학 보고서, 2026-10-26) — 적은 행만. 로스터가 readAttitudeNote로 복원한다. */
      attitudeNote?: string;
      /** '오늘의 수업' 메모(새 수학 보고서, 2026-10-28) — 적은 행만. 로스터가 readLessonMemo로 복원한다. */
      lessonMemo?: string;
      /** 보강 사유(보강 줄, 2026-10-26) — 적은 행만. 로스터가 readMakeupReason으로 복원한다. */
      makeupReason?: string;
    }
  >;
  dailyScore?: number | null;
  dailyMax?: number | null;
  checkScore?: number | null;
  checkMax?: number | null;
  attitude?: string | null;
  homework?: string | null;
  note?: string | null; // 특이사항(강사 메모) — 0093a
  progressConfirmed?: boolean;
  /**
   * 이 창이 마지막으로 본 세션 `updated_at`. 같은 값이면 이 창이 마지막 저장자라 칸을 비워도 반영.
   * 없거나 다르면 덜 쓴 창의 저장은 무시한다(session-write.ts).
   */
  baseUpdatedAt?: string | null;
};

/**
 * 선생님 원스크린 "오늘 작업중" 상태를 onescreen_daily_sessions(0065a)에 upsert.
 * 강사가 입력한 점수/진도/태도/과제/진도확정이 새로고침·재접속에도 유지되도록 서버 영속.
 * saveLessonReport와 동일한 auth + 강사 스코프 이중 방어(담당 반 활성 수강생만). 하루 1행(upsert).
 */
export async function saveOnescreenSession(
  input: SaveOnescreenSessionInput,
): Promise<{ ok: boolean; error?: string; skipped?: boolean; updatedAt?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 임시저장도 저장이다(대상 강사의 세션 행과 섞이면 안 된다).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };

  const supabase = await createClient();

  const sessionDate = resolveReportDate(input.sessionDate);
  // 임시저장(세션)도 위임 반을 포함해야 한다 — 안 그러면 대체 강사가 표에 입력은 되는데 저장이 조용히
  // 거절돼 새로고침에 전부 날아간다(원장 2026-08-03 "임시저장이 없어 불편"의 정반대 사고).
  const { all: myClassIds } = await getTeachingClassIds(supabase, user.id, sessionDate);
  if (myClassIds.length === 0) return { ok: false, error: "담당 반이 없습니다" };

  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", input.studentId)
    .or(`start_date.is.null,start_date.lte.${sessionDate}`)
    .or(`end_date.is.null,end_date.gte.${sessionDate}`)
    .in("class_id", myClassIds)
    .limit(1);
  if (!enr || enr.length === 0) {
    if (!input.outOfClass) return { ok: false, error: "담당 학생이 아닙니다" };
    // 보강 세션도 보고서와 같은 학원 학생 범위. 입력자는 위의 담당 반 게이트를 통과해야 한다.
    const { data: student } = await supabase.from("students").select("id")
      .eq("tenant_id", user.tenantId).eq("id", input.studentId).maybeSingle();
    if (!student) return { ok: false, error: "학원 학생이 아닙니다" };
  }

  // 같은 강사 창이 둘이면 나중 저장이 이겼다(0118a 유니크는 강사축일 뿐 창 축이 아니다).
  // 덜 쓴 창의 자동저장이 멘트·오늘 과제를 지우지 않게, 반영 전에 내용 칸을 견준다(session-write.ts).
  const { data: prior, error: priorError } = await supabase
    .from("onescreen_daily_sessions")
    .select("updated_at, subject_progress, attitude, homework, special_note, daily_score, check_score")
    .eq("student_id", input.studentId)
    .eq("session_date", sessionDate)
    .eq("updated_by", user.id)
    .maybeSingle();
  if (priorError) {
    logDbError(priorError, "onescreen.saveOnescreenSession");
    return { ok: false, error: "임시저장을 확인하지 못했습니다" };
  }
  const incoming: SessionContent = {
    subjectProgress: input.subjectProgress ?? {},
    attitude: input.attitude ?? null,
    homework: input.homework ?? null,
    note: input.note ?? null,
    dailyScore: input.dailyScore ?? null,
    checkScore: input.checkScore ?? null,
  };
  const existing = sessionContentFromRow(prior);
  const sameRevision = sameSessionRevision(input.baseUpdatedAt, prior?.updated_at as string | undefined);
  if (sessionSaveDecision(existing, incoming, sameRevision) === "ignore") {
    return { ok: true, skipped: true, updatedAt: (prior?.updated_at as string | undefined) ?? undefined };
  }

  const payload = {
    tenant_id: user.tenantId,
    student_id: input.studentId,
    session_date: sessionDate,
    class_id: input.classId ?? null,
    study_grade: input.studyGrade ?? null,
    subject_progress: preserveMakeupSessionEntries(
      (prior?.subject_progress ?? {}) as SessionProgress, (input.subjectProgress ?? {}) as SessionProgress,
    ),
    daily_score: input.dailyScore ?? null,
    daily_max: input.dailyMax ?? null,
    check_score: input.checkScore ?? null,
    check_max: input.checkMax ?? null,
    attitude: input.attitude ?? null,
    homework: input.homework ?? null,
    special_note: input.note ?? null,
    progress_confirmed: input.progressConfirmed ?? false,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  let expectedRevision = prior?.updated_at as string | undefined;
  // 두 창이 동시에 '행 없음'을 보고 쓰면 나중 upsert가 이긴다 — 빈 창이 늦게 오면 잘 쓴 값이 사라진다.
  // insert가 유니크 충돌이면 다시 읽어 같은 판정을 한 번 더 한다.
  if (!prior) {
    const ins = await supabase.from("onescreen_daily_sessions").insert(payload).select("updated_at").single();
    if (!ins.error) return { ok: true, updatedAt: (ins.data?.updated_at as string | undefined) ?? undefined };
    const { data: raced } = await supabase
      .from("onescreen_daily_sessions")
      .select("updated_at, subject_progress, attitude, homework, special_note, daily_score, check_score")
      .eq("student_id", input.studentId)
      .eq("session_date", sessionDate)
      .eq("updated_by", user.id)
      .maybeSingle();
    if (sessionSaveDecision(sessionContentFromRow(raced), incoming, false) === "ignore") {
      return { ok: true, skipped: true, updatedAt: (raced?.updated_at as string | undefined) ?? undefined };
    }
    if (!raced) return { ok: false, error: "임시저장을 저장하지 못했습니다" };
    expectedRevision = raced.updated_at as string;
    payload.subject_progress = preserveMakeupSessionEntries(
      (raced.subject_progress ?? {}) as SessionProgress, (input.subjectProgress ?? {}) as SessionProgress,
    );
  }

  // 강사별 세션을 읽은 리비전에서만 갱신한다. 보강 등록·삭제와 자동저장이 서로 명단을 덮지 않게 한다.
  const { data, error } = await supabase
    .from("onescreen_daily_sessions")
    .update(payload)
    .eq("tenant_id", user.tenantId).eq("updated_by", user.id)
    .eq("student_id", input.studentId).eq("session_date", sessionDate)
    // 등록·삭제가 읽기와 쓰기 사이에 끼어도 오래된 명단으로 덮지 않는다.
    .eq("updated_at", expectedRevision)
    .select("updated_at")
    .maybeSingle();
  if (error) return { ok: false, error: humanizeDbError(error.message, "저장") };
  if (!data) return { ok: true, skipped: true };
  return { ok: true, updatedAt: (data?.updated_at as string | undefined) ?? undefined };
}

/**
 * AI 학부모 멘트 + 학습 추세 자동작성 — edutrix generateDailyNotice/generateTrendAnalysis 이식.
 * **통합 1회 호출**: 활성 프롬프트(모드 A=멘트, B=P1·P2)와 추세(표본 충분 시)를 하나의 멀티출력 프롬프트로
 * 조립해 generateJSON을 한 번만 호출한다(학생당 2~3회 → 1회, 비용·지연↓). 프롬프트는 여전히 문구별 편집 가능.
 * trendCtx 주면 추세도 함께 생성해 반환. DB 미변경 → 로그인만 확인. 실패 시 ok:false → 클라 템플릿 폴백.
 */
export async function generateReportComment(
  input: ReportCommentInput,
  // classId = 이 행의 반. 정규/특강 분리(2026-07-23 원장 지시)에 쓴다 — 특강 보고서면 그 반 기록만,
  // 정규면 특강 기록을 제외한다. 미지정이면 기존 동작(안 가름).
  // resolveClass = 반을 모르는 화면(보고서 관리 > 직접 작성)이 넘긴다 — 저장과 같은 규칙(resolveReportClassId, 모호하면 null)으로
  // 반을 정해 **시험은 그 반 기록만** 쓴다(원장 2026-10-15). 저장된 보고서엔 반이 붙는데 추세만 반을 모르면 문장과 그래프가 갈린다.
  trendCtx?: {
    studentId?: string;
    subject?: string;
    classId?: string | null;
    todayExamInfo?: string;
    todayHomework?: string;
    date?: string;
    resolveClass?: { teacherName?: string | null };
  },
  // teacherStyle=false: 사무실 대리작성(보고서 관리 > 직접 작성)이 넘긴다 — 그 멘트는 **다른 강사 이름**으로 나가는 보고서라 호출자의
  // 말투 프로파일(0262a)을 붙이면 안 된다. 스코프 판정(effectiveTeacherId)만으론 겸직 관리자가 강사뷰 쿠키를 켠 채 그 화면을 열면 새므로(재리뷰).
  //
  // pilotKeepUnderstanding: 새 수학 보고서에서 선생님이 **고친 글**을 값만 다시 맞출 때(원장 2026-10-27 *"글을 수정하면 자동작성을 다시 누르라고 …
  // 쓴게 다 없어진데요"*) — '오늘의 수업' AI는 부르지 않고 그 항목은 이 글(선생님이 고친 그대로)로, 나머지 사실 항목만 지금 값으로 다시 짠다
  // (사실 항목 말투 다시 쓰기 — 2026-10-28 restyleFacts — 는 고친 기록이 있는 선생님에게 여기서도 붙는다).
  // 화면이 이 결과와 고친 글을 항목별로 합친다(pilot-merge.ts). 추세는 만들지 않는다.
  opts?: { teacherStyle?: boolean; pilotKeepUnderstanding?: string },
): Promise<{ ok: boolean; comment?: string; trend?: string; trendDropped?: boolean; trendQuiet?: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — DB 미변경이지만 AI 호출(비용)이라 열람에서 못 누르게 한다.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };

  // 학부모께 직접 드리는 사과·양해 문장(특이사항·반 전체 안내)은 AI에 주지 않고 멘트 맨 앞에 그대로 붙인다
  // (2026-09-22 강사 제보 — '인사말·날짜 금지'에 걸려 모델이 때때로 뺐다, parent-address.ts 주석).
  // 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) — 특이사항은 AI에 주지 않고 **맨 아래에 그대로** 붙인다.
  const pilot = isMathReportPilot(trendCtx?.studentId, trendCtx?.subject);
  const pilotNote = pilot ? (input.specialNote ?? "").trim() : "";
  const noteSplit = pilot ? { address: [] as string[], rest: "" } : splitParentAddress(input.specialNote);
  const noticeSplit = splitParentAddress(input.classNotice);
  const parentAddress = [...noteSplit.address, ...noticeSplit.address];
  // 방지로직 — 진도/태도/테스트/과제 등 최소 사실이 하나도 없으면 생성 거부(빈 껍데기 멘트 방지).
  // 개별 자동작성 버튼은 클라에서 진도 없으면 비활성이지만, 서버에서도 이중 방어(edutrix 관례).
  const hasFacts = !!(
    input.progress?.trim() ||
    input.attitude?.trim() ||
    input.dailyTest?.trim() ||
    input.checkTest?.trim() ||
    input.homework?.trim() ||
    input.homeworkToday?.trim() ||
    noteSplit.rest.trim()
  );
  if (!hasFacts) {
    // 특이사항이 사과 문장뿐이면 AI를 부르지 않고 그 문장만 — 재료 없이 부르면 멘트를 지어낸다.
    if (parentAddress.length) return { ok: true, comment: prependParentAddress("", parentAddress) };
    return { ok: false, error: "진도·태도 등을 입력한 뒤 자동작성할 수 있습니다" };
  }
  // 반 공통 서술(G6) — 클라 입력이라 길이 상한(프롬프트 비대·토큰 남용 방지). ⚠️ hasFacts 게이트에는
  // **불포함 유지** — 반 서술만으로 개별 학생 멘트를 생성하면 환각(학생 사실 0 + 반 맥락만)이라 거부가 맞다.
  // 개행 접기 — 여러 줄 서술이 fact 블록의 가드 라벨을 탈출해 맨줄 개별 사실로 위장하는 것 차단(빌더와 이중 방어).
  const safeInput: ReportCommentInput = {
    ...input,
    specialNote: noteSplit.rest,
    classNotice: noticeSplit.rest,
    classContext: input.classContext?.replace(/\s*\n+\s*/g, " ").trim().slice(0, 300) || "",
    // 출결 문장(attendance-sentence.ts가 만든 한 줄) — 클라 값이라 한 줄로 접고 길이를 자른다. 글에 그대로 들어가고 AI에는 안 준다.
    // 보강 문장(결석 날짜 · 시간 · 사유)이 붙으면 길어진다 — 300자까지(2026-10-26).
    attendance: input.attendance?.replace(/\s*\n+\s*/g, " ").trim().slice(0, 300) || "",
    // 이해도는 시범 대상에만 — 다른 학생 입력에 실려 와도 프롬프트에 안 넣는다(클라 값을 믿지 않는다).
    understanding: pilot
      ? (input.understanding ?? [])
          // rated = 선생님이 직접 매겼나(원장 2026-10-28 — 안 매긴 기본값 10은 표에만, 글로는 안 쓴다). 표식이 없으면(옛 화면) 매긴 것으로.
          .map((u) => ({ title: String(u.title ?? "").trim().slice(0, 80), score: clampUnderstanding(u.score), rated: u.rated !== false }))
          .filter((u): u is { title: string; score: number; rated: boolean } => !!u.title && u.score != null)
          .slice(0, 20)
      : undefined,
  };
  // 수학 보고서 시범 — 항목별 글(math-report-pilot-sections.ts). 테스트·태도·과제는 고른 값을 코드가 옮기고 AI는 '이해도' 항목만 쓴다.
  const pilotSkip: DailyTestSkip | null = pilot ? readTestSkip(input.dailyTestSkip) : null;
  // 매크로성 반복 금지(원장 2026-10-26) — 직전 보고서 글을 미리 읽어 둔다(AI 호출과 겹쳐 돈다). 코드 문장은 거기 쓴 갈래를 피하고,
  // AI엔 '다른 표현으로'의 참고로 준다. 시드 = 학생·보고서 날짜·과목(같은 날 다시 눌러도 같은 갈래 — 서명은 값으로 만들어 흔들리지 않는다).
  const pilotStudentId = pilot ? trendCtx?.studentId : undefined;
  const prevNotesP: Promise<string | null> = pilotStudentId
    ? createClient()
        .then((sb) => fetchPrevReportNotes(sb, pilotStudentId, trendCtx?.subject, resolveReportDate(trendCtx?.date)))
        .catch(() => null)
    : Promise.resolve(null);
  // 비포클래스체크리스트(원장 2026-10-30) — 그 반·그날 체크가 있으면 수업 평가 표에 줄을 붙인다(report-rows.ts). 반을 모르면 줄 없음.
  //   🔴 개인별 기능 권한 '비포클래스 보고서 표'에 지정한 선생님(강사뷰 기준 user) 또는 테스트 학생에게만(beforeClassReportEnabled).
  //   아래 갈래마다 다른 재료와 함께 기다린다(B4) — 받은 값은 `beforeClassRows`에 두고 표를 짤 때 쓴다.
  const beforeClassRowsP: Promise<ReportCheckRow[]> =
    pilotStudentId && trendCtx?.classId
      ? beforeClassReportEnabled(user.tenantId, pilotStudentId, user.id).then((on) =>
          on && trendCtx.classId ? loadBeforeClassReportRows(user.tenantId, trendCtx.classId, pilotStudentId, resolveReportDate(trendCtx.date)) : [])
      : Promise.resolve([]);
  let beforeClassRows: ReportCheckRow[] = [];
  const varietyOf = (prev: string | null): Variety | null =>
    pilotStudentId ? { seed: `${pilotStudentId}|${resolveReportDate(trendCtx?.date)}|${trendCtx?.subject ?? ""}`, prev } : null;
  // '오늘의 수업' 메모(원장 2026-10-28) — 그날 한 일. 시범 행만, 한 줄 300자.
  const lessonMemo = pilot ? readLessonMemo(input.lessonMemo) : "";
  // 글로 쓰는 이해도 = 선생님이 직접 매긴 소단원만(원장 2026-10-28 — 기본값 10이 "잘 이해했습니다"로 나가 선생님이 지웠다). 표는 전부로 그린다.
  const ratedItems = pilot ? ratedUnderstanding(safeInput.understanding) : [];
  // 선생님이 늘 지우는 문장(teacher-habits.ts — 다짐·두루뭉술한 묘사·소단원 나열) — 자동작성할 때마다 그 선생님 최근 기록으로 다시 판정한다
  // (원장 2026-10-28 *"자주 지우면 생략"* — cron 없음, 배포 즉시). 스코프 = 말투 프로파일과 같다(사무실 대리작성은 종전 어투).
  const habitsP: Promise<TeacherHabits> =
    pilot && opts?.teacherStyle !== false
      ? effectiveTeacherId()
          .then((teacherId) => (teacherId ? loadTeacherHabits(createAdminClient(), user.tenantId, teacherId) : NO_HABITS))
          .catch(() => NO_HABITS)
      : Promise.resolve(NO_HABITS);
  // 선생님이 직접 적은 말 — 습관 문장 떼기에서도 지킨다.
  const teacherWords = pilot
    ? [readAttitudeNote(input.attitudeNote), readHomeworkMissReason(input.homeworkMissReason), pilotSkip?.detail ?? "", lessonMemo]
    : [];
  /**
   * `ownUnderstanding` = '오늘의 수업' 글이 선생님이 고친 글이다(값만 다시 맞추기) — 그 항목은 습관으로도 손대지 않는다.
   * 메모를 적은 날도 '오늘의 수업'은 떼지 않는다(메모에서 온 계획 문장이 다짐 문장으로 보여 지워질 수 있다).
   */
  const composePilot = (
    understandingText: string,
    videoReceipt: string | null,
    variety: Variety | null = null,
    habits: TeacherHabits = NO_HABITS,
    ownUnderstanding = false,
  ) => {
    const text = applyHabitsToSections(composePilotRaw(understandingText, videoReceipt, variety), habits, {
      skipTitles: [
        PILOT_SECTION_TITLES.levels,
        PILOT_SECTION_TITLES.note,
        PILOT_SECTION_TITLES.attendance,
        ...(ownUnderstanding || lessonMemo ? [PILOT_SECTION_TITLES.understanding] : []),
      ],
      keep: teacherWords,
    });
    // 테스트 점수 줄을 늘 지우는 선생님은 처음부터 안 쓴다(원장 2026-10-30 — teacher-habits.ts `omitScore`).
    return habits.omitScore ? dropScoreLines(text, [PILOT_SECTION_TITLES.daily, PILOT_SECTION_TITLES.check]) : text;
  };
  function composePilotRaw(understandingText: string, videoReceipt: string | null, variety: Variety | null) {
    return composePilotMent({
      // 수업 평가 표가 맨 위, 그다음 진도(원장 2026-10-23 *"진도보다 위에 표 형태로"*).
      lead: [
        pilotLevelsSection(safeInput, beforeClassRows),
        pilotSection(
          PILOT_SECTION_TITLES.progress,
          progressLead(input.studentName, pilotLessons(input.progress), skipStatusOf(input.progress), input.progressMode, variety),
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      body: pilotBody(
        {
          ...safeInput,
          dailyTestSkip: pilotSkip,
          homeworkMissReason: readHomeworkMissReason(input.homeworkMissReason),
          attitudeNote: readAttitudeNote(input.attitudeNote),
        },
        { understandingText, videoReceipt, variety },
      ),
      note: pilotNote,
    });
  }
  // 사실 항목 말투(원장 2026-10-28 *"다른 영역도 수정한 사람들 … 그에 맞게 다 말투 언어 모두 학습"*) — 그 선생님이 자동작성 글의 사실 항목을
  // 고쳐 보낸 기록이 있으면, 같은 사실을 그 말투로 다시 쓴다(pilot-restyle.ts — 항목마다 사실 검사를 지난 것만, 아니면 코드 글 그대로).
  // 스코프 = 말투 프로파일과 같은 규칙(effectiveTeacherId · 사무실 대리작성 teacherStyle=false는 안 붙인다). 고친 기록이 없으면 AI를 안 부른다.
  // 요청 초반에 시작해 다른 조회와 겹쳐 돈다(B4).
  const restyleCtxP: Promise<{ examples: SectionEditExample[]; style: MentStyleProfile | null } | null> =
    pilot && opts?.teacherStyle !== false
      ? effectiveTeacherId()
          .then(async (teacherId) => {
            if (!teacherId) return null;
            const admin = createAdminClient();
            const examples = await loadSectionEditExamples(admin, user.tenantId, teacherId);
            if (!examples.length) return null;
            return { examples, style: await loadTeacherMentStyle(admin, user.tenantId, teacherId) };
          })
          .catch(() => null)
      : Promise.resolve(null);
  // 선생님이 직접 적어 글에 그대로 들어간 말 — 다시 쓴 글에도 글자 그대로 남아야 받는다.
  const restyleMustKeep = pilot
    ? [readAttitudeNote(input.attitudeNote), readHomeworkMissReason(input.homeworkMissReason), pilotSkip?.detail ?? ""]
    : [];
  const restyleFacts = async (composed: string): Promise<string> => {
    const [ctx, habits] = await Promise.all([restyleCtxP, habitsP]);
    return ctx
      ? restylePilotSections({
          composed,
          examples: ctx.examples,
          style: ctx.style,
          studentName: input.studentName,
          tenantId: user.tenantId,
          mustKeep: restyleMustKeep,
          omitScore: habits.omitScore,
        })
      : composed;
  };
  // 고친 글의 값만 다시 맞추기 — AI 없이 사실 항목만(위 opts 주석). 글은 클라 값이라 한 항목 길이로 자른다.
  // (말투 다시 쓰기는 고친 기록이 있는 선생님에게만 붙는다 — 화면이 항목별로 합칠 때 선생님이 손댄 항목은 어차피 그대로 둔다.)
  if (pilot && typeof opts?.pilotKeepUnderstanding === "string") {
    const keep = opts.pilotKeepUnderstanding.trim().slice(0, 4000);
    const [videoReceipt, prevNotes, habits, bcRows] = await Promise.all([
      getVideoReceiptComment(user.tenantId, trendCtx ?? {}).catch(() => null),
      prevNotesP,
      habitsP,
      beforeClassRowsP,
    ]);
    beforeClassRows = bcRows;
    return { ok: true, comment: await restyleFacts(composePilot(keep, videoReceipt, varietyOf(prevNotes), habits, true)) };
  }
  // 이해도를 하나도 안 매겼으면 AI가 쓸 항목이 없다 — 부르지 않는다(재료 없이 부르면 이해도를 지어낸다). 추세도 이번엔 안 만든다.
  // 매긴 이해도가 없어도 '오늘의 수업' 메모가 있으면 AI가 메모로 쓴다(원장 2026-10-28).
  if (pilot && !ratedItems.length && !lessonMemo) {
    const [videoReceipt, prevNotes, habits, bcRows] = await Promise.all([
      getVideoReceiptComment(user.tenantId, trendCtx ?? {}).catch(() => null),
      prevNotesP,
      habitsP,
      beforeClassRowsP,
    ]);
    beforeClassRows = bcRows;
    return { ok: true, comment: await restyleFacts(composePilot("", videoReceipt, varietyOf(prevNotes), habits)) };
  }
  // AI에는 진도·이해도만 준다 — 다른 사실을 주면 모델이 그 항목을 '이해도' 글에 다시 쓴다(항목이 겹친다).
  const aiInput: ReportCommentInput = pilot
    ? {
        ...safeInput,
        dailyTest: "",
        checkTest: "",
        attitude: "",
        homework: "",
        homeworkToday: "",
        videoHomework: undefined,
        videoHomeworkDue: undefined,
        specialNote: "",
        classNotice: "",
        classContext: "",
        dailyTestSkip: undefined,
        homeworkMissReason: undefined,
        attitudeNote: undefined,
        attendance: "",
        // 매긴 소단원만(위 ratedItems). 메모는 지시(pilotAiDirective)로 따로 준다 — 특이사항 칸은 시범에선 사랑의 한마디다.
        understanding: ratedItems,
        lessonMemo: undefined,
      }
    : safeInput;
  try {
    const supabase = await createClient();
    // 말투 프로파일(0262a)의 주인 = **이 화면의 강사 스코프**(실 강사·겸직 강사뷰 = `effectiveTeacherId`). 관리자 뷰(사무실 대리작성)는
    // 스코프가 없어(null) 프로파일을 **읽지 않는다** — 그 멘트는 다른 강사 이름으로 나가는 보고서라 사무실 계정 말투가 붙으면 안 된다.
    // 프로파일이 없거나 표가 아직 없으면(미적용) 아무것도 안 붙는다([[#95]]).
    // 멘트 모드 — 강사 본인 오버라이드(users.report_notice_mode) > 학원 기본(report.noticeMode) > 'A'.
    // 설정·모드·말투 세 조회는 서로 독립 — 직렬 워터폴 금지(B4). 겸직 강사뷰의 스코프 판정(쿠키+담당 반)도 이 안에서 돈다.
    const [settings, { data: meRow }, mentStyle, videoReceipt, prevNotes, bcRows] = await Promise.all([
      getTenantSettings(),
      supabase.from("users").select("report_notice_mode").eq("id", user.id).single(),
      opts?.teacherStyle === false
        ? null
        : effectiveTeacherId().then((teacherId) => (teacherId ? loadTeacherMentStyle(createAdminClient(), user.tenantId, teacherId) : null)),
      getVideoReceiptComment(user.tenantId, trendCtx ?? {}).catch(() => null),
      prevNotesP,
      beforeClassRowsP,
    ]);
    beforeClassRows = bcRows;
    const habits = await habitsP;
    // 사실 항목 말투(위 restyleFacts) — '오늘의 수업' 없이 같은 값으로 조립한 사실 글을 지금 다시 써 두고, AI 호출과 나란히 돈다.
    // 최종 글엔 아래에서 옮긴다(transplantRestyle — 항목 글이 글자 그대로 같을 때만). restyleFacts는 던지지 않는다.
    const factOriginal = pilot ? composePilot("", videoReceipt, varietyOf(prevNotes), habits) : "";
    const factRestyledP: Promise<string> = pilot ? restyleFacts(factOriginal) : Promise.resolve("");
    const styleBlock = mentStyle ? mentStyleDirective(mentStyle) : "";
    // 추세엔 **어조·문장 결만** — 선생님 표현·마무리("다음 시간에 ~하겠습니다")까지 붙이면 추세 금지(계획)에 걸려 버려진다(2026-10-16).
    const toneBlock = mentStyle ? mentStyleToneDirective(mentStyle) : "";
    // 시범 대상은 단일 문단(A) 고정 — 첫 문장·이해도·특이사항을 코드가 앞뒤에 붙이는 구조라 2문단(B)과 섞이지 않는다.
    const mode = pilot ? "A" : ((meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? settings.report.noticeMode ?? "A");

    // 추세(선택) — 컨텍스트 있고 표본 충분할 때만. 대상 날짜(작업중, 미저장일 수 있음) 포함(edutrix 패리티).
    // ⚠️ 과거 날짜 보고서: 그 뒤에 이미 채점 이력이 있으면 추세 미반영 — 뒤늦게 끼우는 과거 점이 추세 그래프/서술을 흐트러뜨림(원장 2026-07-14).
    // 사실 줄이 있을 때만 — 추세 섹션을 만들고, 생성 뒤 대조(findTrendContradictions)에도 쓴다.
    let trendInput: TrendInput | null = null;
    // 지난 보고서와 달라진 게 없다(trendNews) — 이번 회차엔 추세를 쓰지 않는다. 칸은 화면이 정한다: 지난 자동작성이 넣은 글 그대로면
    //   비우고, 선생님이 손으로 쓰거나 고친 글이면 둔다(적대적 재리뷰 2026-10-16 — 일괄 자동작성이 반 전체의 손글씨 추세를 지웠을 것).
    let trendQuiet = false;
    if (trendCtx?.studentId) {
      const anchorDate = resolveReportDate(trendCtx.date); // 대상 날짜(빈값·미래→오늘)
      const skipTrend =
        anchorDate < kstToday() && (await hasLaterScoredReport(supabase, trendCtx.studentId, trendCtx.subject, anchorDate));
      if (!skipTrend) {
        const [specialClassIds, resolvedClassId] = await Promise.all([
          fetchSpecialClassIds(supabase),
          trendCtx.classId === undefined && trendCtx.resolveClass && trendCtx.subject
            ? resolveReportClassId(supabase, {
                studentId: trendCtx.studentId,
                reportDate: anchorDate,
                subject: trendCtx.subject,
                teacherName: trendCtx.resolveClass.teacherName ?? null,
              })
            : Promise.resolve(undefined),
        ]);
        const trendClassId = trendCtx.classId !== undefined ? trendCtx.classId : (resolvedClassId ?? undefined);
        // 90일을 읽는다 — 반복 방지가 최근 60일 안의 지난 추세 회차를 그 회차의 30일 창으로 다시 계산한다(사실은 30일 창만, buildTrendInput).
        const history = await fetchScoreHistory(supabase, trendCtx.studentId, trendCtx.subject, anchorDate, 90, {
          classId: trendClassId,
          specialClassIds,
          lookbackDays: TREND_HISTORY_FETCH_DAYS,
        });
        history.push({
          date: anchorDate,
          examInfo: trendCtx.todayExamInfo?.trim() || null,
          homeworkScore: trendCtx.todayHomework?.trim() || null,
          classId: trendClassId ?? null,
        });
        const ti = buildTrendInput(history, { today: anchorDate });
        if (ti && ti.facts.length) trendInput = ti;
        else if (ti?.quiet) trendQuiet = true;
      }
    }

    // 🔴 조립·응답 읽기·생성 뒤 검사 = AI 멘트 탭 미리보기와 **같은 함수**(ment-assembly.ts — 원장 2026-10-16 미리보기 = 실제와 같게).
    //    활성 프롬프트(DB > 기본)는 이 모드·추세에 쓰는 것만 읽는다 — 넷은 서로 독립(B4).
    const [tplComment, tplP1, tplP2, tplTrend] = await Promise.all([
      mode === "B" ? null : loadActivePrompt(supabase, user.tenantId, "comment"),
      mode === "B" ? loadActivePrompt(supabase, user.tenantId, "comment_p1") : null,
      mode === "B" ? loadActivePrompt(supabase, user.tenantId, "comment_p2") : null,
      trendInput ? loadActivePrompt(supabase, user.tenantId, "trend") : null,
    ]);
    const sections = mentSections({
      mode,
      input: aiInput,
      templates: { comment: tplComment, comment_p1: tplP1, comment_p2: tplP2, trend: tplTrend },
      // 결 변형 시드가 결정적이라 같은 학생·같은 날 재생성해도 결이 흔들리지 않는다. 날짜는 **보고서 날짜**(빈 값 = 오늘) —
      //   원스크린은 오늘을 볼 때 date를 비워 보내 시드가 `이름||과목`이 됐고, 한 학생이 날마다 같은 결로 열렸다(2026-10-16 미리보기 후속에서 발견).
      styleSeed: `${input.studentName}|${resolveReportDate(trendCtx?.date)}|${input.subject}`,
      styleBlock,
      toneBlock,
      trend: trendInput,
      // 직전 보고서의 '오늘의 수업' 문단 = 표현 참고(사실 아님) — 같은 말이 매번 나가지 않게(원장 2026-10-26).
      ...(pilot ? { extraDirective: [pilotAiDirective(input.studentName, { habits, memo: lessonMemo }), prevPhrasingHint(prevNotes)].filter(Boolean).join("\n") } : {}),
    });
    if (sections.length === 0) return { ok: false, error: "생성할 내용이 없습니다" };

    // 통합 1회 호출 — 멘트(·추세)를 한 번에 {comment|p1|p2, trend}로 생성. temp 0.3·reasoning minimal(Solar 후보정) 적용.
    // 보고서 멘트·추세는 **fast tier**(Claude Haiku 5.5 — 2026-10-16 4.5에서 올림 / 키 죽으면 DeepSeek flash 폴백) — 사실 서술형이라 Sonnet 불요, 비용 절감(원장 결정 2026-07-14).
    // ⚠️ 이 tier 지정은 **멘트 호출에만** — 다른 AI는 balanced(Sonnet 5.5 · 기능별 고정은 model-pins.ts). Haiku도 Anthropic 키가 살아야 동작(아니면 DeepSeek).
    const { data } = await generateJSON<Record<string, unknown>>({
      prompt: assembleCombined(sections),
      maxTokens: mentMaxTokens(safeInput),
      keyName: "default",
      tier: "fast",
      meta: { feature: "classnote_ment", tenantId: user.tenantId },
      ...MENT_AI_TUNING,
    });
    const res = readMentResponse(data, mode, trendInput);
    if (!res.comment) return { ok: false, error: "빈 응답" };
    const body = prependParentAddress(appendVideoReceiptComment(res.comment, videoReceipt), parentAddress);
    // 시범 대상 — 항목별 글(진도 → 테스트 → 태도 → 과제 → 이해도(AI) → 오늘 과제 → 선생님 한마디).
    // 이해도 글은 후보정을 거친다 — 점수 숫자·규칙 혼잣말이 든 문장은 빼고, 다 빠지면 정해진 문장으로(2026-10-23 실측 누출).
    const comment = pilot
      ? transplantRestyle(
          composePilot(cleanPilotUnderstanding(res.comment, ratedItems, { habits, memo: lessonMemo }), videoReceipt, varietyOf(prevNotes), habits),
          factOriginal,
          await factRestyledP,
        )
      : body;
    if (res.dropped)
      console.warn(
        JSON.stringify({
          level: "warn",
          scope: "generateReportComment.trend",
          reason: res.badSpans.length ? "impossible_scale_span" : "banned_phrase",
          spans: res.badSpans,
          violations: res.violations,
          message: "추세 문장에 기록에 없는 내용·사실일 수 없는 표기가 있어 저장하지 않음",
        }),
      );
    // trendDropped = 이번에 만든 추세를 버렸다 — 화면은 추세 칸을 비운다(안 비우면 예전 초안이 그대로 발송된다, 적대적 리뷰 2026-10-15).
    //    trendQuiet = 달라진 게 없어 안 만들었다 — 화면이 자동작성 글이면 비우고 손글씨면 둔다. 표본 부족은 종전대로 기존 초안·손 입력을 둔다.
    //    모델이 추세를 **비워 보냈다**(본문이 이미 같은 말을 했거나 오늘 값과 어긋나 쓸 말이 없다 — 2026-10-16 시험 120회 중 5회)도 같은 뜻이다.
    //    ⚠️ 응답에 trend 키가 **아예 없는** 것(대체 provider가 계약을 빠뜨림)은 일부러 비운 게 아니다 — 지난 초안을 비우지 않는다(적대적 리뷰).
    const quiet = trendQuiet || res.quietByModel;
    return { ok: true, comment, trend: res.trend, ...(res.dropped ? { trendDropped: true } : {}), ...(quiet ? { trendQuiet: true } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI 생성 실패" };
  }
}

/**
 * 강사 본인의 AI 멘트 공지 모드(단일 A / 2문단 B) 저장 — 0104a. null=학원 기본 따름.
 * users.report_notice_mode에 본인 행만. admin client + (id,tenant_id) 스코프(RLS 우회지만 자기 행만 강제).
 * 소비: generateReportComment(강사값 > 학원기본 > 'A'). getTeacherRoster가 현재값을 클라 토글로 내려줌.
 */
export async function setMyNoticeMode(
  mode: "A" | "B" | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 화면은 대상 강사의 값을 보여주는데 저장은 본인 행이라, 허용하면
  // "저장했는데 안 바뀜"으로 보인다. 열람에선 아예 막는 게 정직하다.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (mode !== null && mode !== "A" && mode !== "B") return { ok: false, error: "잘못된 모드입니다" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ report_notice_mode: mode })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: humanizeDbError(error.message, "저장") };
  return { ok: true };
}

/**
 * 원스크린 '글씨 크기'(작음/보통/큼)를 **본인 계정**에 저장 — users.ui_prefs.onescreen.fontSize.
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스라 **onescreen 키만 갈아끼우고 형제 키(timetable 등)는 보존**한다
 *    (saveTimetableViewPrefs와 같은 규약 — 한 화면 저장이 다른 화면 설정을 지우면 안 된다).
 * ⚠️ 기본값('작음')이면 키를 지운다 — 빈 값이 쌓이지 않게.
 * ⚠️ `revalidatePath` 없음: 크기는 클라 state가 즉시 반영하고, 이 저장은 다음 방문용 영속화일 뿐이다.
 */
export async function setMyOnescreenFontSize(
  size: OnescreenFontSize,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — setMyNoticeMode와 같은 이유(화면=대상 값·저장=본인 행 불일치 방지).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!(ONESCREEN_FONT_SIZES as readonly string[]).includes(size))
    return { ok: false, error: "잘못된 글씨 크기입니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw.onescreen && typeof raw.onescreen === "object" && !Array.isArray(raw.onescreen)
      ? { ...(raw.onescreen as Record<string, unknown>) }
      : {};
  if (size === DEFAULT_ONESCREEN_FONT_SIZE) delete ns.fontSize;
  else ns.fontSize = size;

  const merged = { ...raw };
  if (Object.keys(ns).length === 0) delete merged.onescreen;
  else merged.onescreen = ns;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: humanizeDbError(error.message, "저장") };
  return { ok: true };
}

/**
 * 영어 보고서 템플릿 **내 기본값**(원장 2026-10-27 *"사용자 별 자기가 최근 사용한걸 디폴트로"*) — 드롭다운에서 고른 템플릿을
 * 본인 계정 `users.ui_prefs.onescreen`에 적는다 — 그 반의 기록(`lastTemplateByClass`) + 계정의 마지막 선택(`lastTemplateId`).
 * 반을 먼저 보는 이유는 last-template.ts. 글씨 크기와 같은 규약(형제 키 보존).
 * ⚠️ 보기 설정이라 감사로그·revalidatePath 없음(다음에 연 화면의 빈 행 기본값일 뿐 — 이미 쓴 글은 안 바뀐다).
 */
export async function setMyLastReportTemplate(
  templateId: string,
  classId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!isTemplateIdShape(templateId)) return { ok: false, error: "잘못된 템플릿입니다" };
  if (classId !== null && !isTemplateIdShape(classId)) return { ok: false, error: "잘못된 반입니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw.onescreen && typeof raw.onescreen === "object" && !Array.isArray(raw.onescreen)
      ? { ...(raw.onescreen as Record<string, unknown>) }
      : {};
  const prev = readTemplatePrefs(raw);
  if (prev.last === templateId && (!classId || prev.byClass[classId] === templateId)) return { ok: true };
  const next = rememberTemplate(prev, templateId, classId);
  ns[LAST_TEMPLATE_PREF] = next.last;
  ns[LAST_TEMPLATE_BY_CLASS_PREF] = next.byClass;
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, onescreen: ns } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: humanizeDbError(error.message, "저장") };
  return { ok: true };
}

/**
 * **학습 추세 미발송** 켜기·끄기(원장 2026-09-18) — 본인 계정 `ui_prefs.onescreen.trendOptOut`에 `반:학생`을 넣고 뺀다.
 *
 * 🔴 켜는 순간 **아직 안 나간 내 보고서**의 추세도 비운다 — 사무실 일괄 발송(발송 콘솔)은 원스크린을 거치지 않고
 *    저장된 행을 그대로 보내서, 체크 전에 저장해 둔 추세가 나간다(체크가 거짓말이 된다).
 *    범위는 좁게: **내가 쓴 행(created_by)** · 같은 반·학생 · 발송 성공 전 · 최근 14일. 이미 나간 보고서는 못 되돌린다.
 * ⚠️ 끄면 비운 추세는 **돌아오지 않는다**(행에 남기지 않았다) — 원스크린 작업 초안엔 남아 있어 그날 행은 다시 저장하면 된다.
 * ⚠️ 형제 설정(글씨 크기·다른 화면)은 보존한다(setMyOnescreenFontSize와 같은 병합 규약).
 */
export async function setMyTrendOptOut(input: {
  classId: string;
  studentId: string;
  on: boolean;
}): Promise<{ ok: boolean; error?: string; cleared?: number }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  const key = trendOptOutKey(input.classId, input.studentId);
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!key || !uuid.test(input.classId) || !uuid.test(input.studentId))
    return { ok: false, error: "반·학생을 확인할 수 없습니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) {
    logDbError(readErr, "onescreen.setMyTrendOptOut");
    return { ok: false, error: "설정을 불러오지 못했습니다" };
  }
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw.onescreen && typeof raw.onescreen === "object" && !Array.isArray(raw.onescreen)
      ? { ...(raw.onescreen as Record<string, unknown>) }
      : {};
  const next = nextTrendOptOut(readTrendOptOut(raw), key, input.on);
  if (next.length === 0) delete ns[TREND_OPTOUT_PREF];
  else ns[TREND_OPTOUT_PREF] = next;
  const merged = { ...raw };
  if (Object.keys(ns).length === 0) delete merged.onescreen;
  else merged.onescreen = ns;
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    logDbError(error, "onescreen.setMyTrendOptOut");
    return { ok: false, error: "설정을 저장하지 못했습니다" };
  }
  // 보기 설정과 달리 학부모 글을 바꾸는 값이라 감사로그를 남긴다 — 활동 로그는 0444a부터 ui_prefs를 안 남긴다(그 전엔 유일한 흔적).
  const audit = (cleared: number) =>
    logAction({
      action: "onescreen_trend_optout",
      targetType: "student",
      metadata: { classId: input.classId, studentId: input.studentId, on: input.on, cleared },
    });

  if (!input.on) {
    await audit(0);
    return { ok: true, cleared: 0 };
  }
  // 아직 안 나간 내 보고서의 추세 비우기 — RLS 클라이언트(테넌트 격리) + 내 행만.
  const supabase = await createClient();
  const { data: cleared } = await supabase
    .from("lesson_reports")
    .update({ trend_note: null })
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("created_by", user.id)
    .gte("report_date", addDays(kstToday(), -14))
    .not("trend_note", "is", null)
    .or("classnote_status.is.null,classnote_status.neq.success")
    .select("id");
  await audit(cleared?.length ?? 0);
  return { ok: true, cleared: cleared?.length ?? 0 };
}

/** 보강(수업외) 학생 수동추가 picker — 같은 학원 재원·휴원 학생 이름검색(퇴원 제외), 최대 20건. */
export async function searchTenantStudents(
  query: string,
): Promise<{ id: string; name: string; label: string }[]> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return [];
  const q = query.trim();
  if (q.length < 1) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, school")
    .neq("status", "withdrawn")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(20);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    label: schoolGradeLabel(s.school ?? null, s.grade ?? null),
  }));
}

/**
 * 보강(수업외) 학생 1명을 원스크린에 추가할 OneScreenStudent로 조립.
 * 과목 = 강사 담당 반의 과목들, 교재 = 그 학생 교재요청서 기본값. isMakeup=true(세션 미저장·보강 저장 스코프).
 * prevReport(이전 회차)는 v1 미포함(ad-hoc 보강은 참고행 생략 — 정규 로스터와 달리 경량).
 */
export async function buildMakeupStudent(
  studentId: string,
  reportDate?: string, // 조회 중인 날짜(과거 백필 지원) — 발송상태 복원 쿼리가 이 날짜 기준이어야 중복게시 방지
): Promise<{ ok: boolean; student?: OneScreenStudent; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!studentId) return { ok: false, error: "학생 정보가 없습니다" };
  const supabase = await createClient();
  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const testMaxByKey = new Map(settings.operations.subjects.map((s) => [s.key, s.testMax ?? 5]));

  const { data: stu } = await supabase
    .from("students")
    .select("id, name, grade")
    .eq("id", studentId)
    .maybeSingle();
  if (!stu) return { ok: false, error: "학원 학생이 아닙니다" };

  // 과목 = 그 날짜에 내가 가르치는 반(담당 ∪ 위임)의 과목들 — 위임받은 반이 다른 과목이면 그 과목 행도 열린다.
  const [myClasses, orders] = await Promise.all([
    getTeachingClasses(supabase, user.id, resolveReportDate(reportDate)),
    getTextbookOrdersForStudents([studentId]),
  ]);
  const subjectKeys = [...new Set(myClasses.map((c) => c.subject).filter(Boolean) as string[])];
  if (subjectKeys.length === 0) return { ok: false, error: "담당 과목이 없습니다" };

  const bookPick = [...orders]
    .filter((o) => o.bookName?.trim())
    .sort((a, b) => {
      const at = a.teacherName === user.displayName ? 0 : 1;
      const bt = b.teacherName === user.displayName ? 0 : 1;
      if (at !== bt) return at - bt;
      return (b.requestDate ?? b.createdAt ?? "").localeCompare(a.requestDate ?? a.createdAt ?? "");
    })[0];
  const book = bookPick?.bookName?.trim() ?? "";
  const tmax = testMaxByKey.get(subjectKeys[0]!) ?? 5;

  // ⚠️ 대상 날짜 발송상태 복원 — 보강 학생은 세션 미저장이라 재추가 시 상태가 빈다. 그대로면 이미 발송(success)된 과목을
  //    다시 눌러 ClassNote 중복 게시될 수 있다(#13 확정). **조회 중인 날짜**(과거 백필 포함) lesson_reports를 과목별로
  //    매핑해 sent/토큰/상태 복원 — 저장/발송이 쓰는 reportDate와 동일 날짜여야 과거 날짜에서도 중복게시 방지.
  // 🔴 **class_id IS NULL(보강 유닛)만** 복원한다(2026-07-24 적대검수 확정). 보강 보고서는 unit_key=coalesce(class_id,subject)=과목이라
  //    class_id가 항상 NULL이고, 정규/특강 반 보고서는 class_id가 붙는다. 스코프를 안 하고 과목만으로 매핑하면
  //    같은 과목 **정규 발송본**(class_id 있음, classnote_status='success')을 보강 행이 물려받아 ① born-locked(저장·발송 영영 불가)
  //    ② 보강 행의 재발급/취소가 정규 보고서 토큰을 회전·무효화(학부모 라이브 링크 파괴)한다. class_id null 스코프면
  //    유니크(unit_key)로 과목당 ≤1행 → Map도 결정적(정렬·last-wins 비결정 제거).
  const targetDate = resolveReportDate(reportDate);
  const { data: todayReports } = await supabase
    .from("lesson_reports")
    .select("subject, share_token, classnote_status, revoked_at, attachments")
    .eq("student_id", studentId)
    .eq("report_date", targetDate)
    .is("class_id", null);
  const statusBySubject = new Map(
    (todayReports ?? []).map((r) => [r.subject ?? "", r]),
  );

  const student: OneScreenStudent = {
    id: stu.id,
    name: stu.name,
    grade: stu.grade ?? "",
    tag: "보강",
    className: "보강",
    isMakeup: true,
    attendance: "출석",
    subjects: subjectKeys.map((key) => {
      const st = statusBySubject.get(key);
      return {
        name: subjectMaps.labelOf(key),
        subjectKey: key,
        prev: "",
        today: "",
        // 교재요청서 기본값은 **math 행에만** — `textbook_orders`엔 과목 컬럼이 없어 영어 행에 주면
        // 수학 교재가 영어 보고서에 미리 채워진다(roster.ts의 같은 게이트와 한 쌍, 2026-07-29).
        textbook: (key || LEGACY_REPORT_SUBJECT) === LEGACY_REPORT_SUBJECT ? book : "",
        makeup: true,
        homeworkToday: "",
        reportSent: !!st,
        shareToken: st?.share_token ?? undefined,
        classnoteStatus: st?.classnote_status ?? undefined,
        revokedAt: st?.revoked_at ?? undefined,
        attachments: (st?.attachments as { path: string; name: string }[] | null) ?? undefined,
      };
    }),
    tests: {
      daily: { score: null, max: tmax, prevScore: null },
      check: { score: null, max: tmax, prevScore: null },
    },
    attitude: null,
    homework: "",
    note: "",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  };
  return { ok: true, student };
}

/**
 * 보강(수업외) 학생 '이전 진도 불러오기' — buildMakeupStudent는 경량이라 직전 회차를 안 담는다.
 * 강사가 버튼을 누르면 그 학생의 (과목)별 직전 lesson_reports를 당겨와 prev/prevReport로 반환(roster와 동일 규격).
 * prevScore(일일/확인)는 **이 강사가 가르치는 과목**의 최신 회차 exam_info로(2026-07-29 과목 분리).
 *
 * ⚠️ **알려진 한계(고의로 남김)**: 이 함수는 `class_id`를 읽지 않아 과목 판정이 `subject` 컬럼 하나에 걸린다
 *    → `subject IS NULL`인데 **반은 영어**인 보고서가 생기면 `reportSubject()`가 레거시 규칙대로 math로 오분류한다.
 *    현재 그런 행은 **0건**이라 무해하다(이관분은 전부 반도 과목도 없는 수학, aywa 저장분은 항상 subject를 쓴다 —
 *    클라가 `su.subjectKey`를 넘긴다). 영어를 aywa에서 발송하기 시작한 뒤에도 이 전제가 유지되는지 확인할 것.
 *    깨진다면 수리 = select에 `class_id` 추가 + `reportSubject({subject, classSubject})`로 roster.ts와 같게.
 *    (roster.ts의 `subjectOfPrior`는 이미 반 과목까지 본다 — 단 **강사 담당 반**만 아는 한계는 동일.)
 */
export async function loadMakeupHistory(
  studentId: string,
  reportDate?: string, // 조회 중인 날짜(과거 백필) — '직전 회차' 기준. roster RPC p_before와 동일 의미로 통일.
): Promise<{
  ok: boolean;
  bySubject?: Record<string, { prev: string; prevReport: PrevReport }>;
  prevScore?: { daily: number | null; check: number | null };
  error?: string;
}> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!studentId) return { ok: false, error: "학생 정보가 없습니다" };
  const supabase = await createClient();
  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);

  // 대상 날짜 **이전**(직전) 보고서만, 최신순. RLS가 테넌트 격리. 한 학생이라 limit 소량.
  // ⚠️ 과거 백필 시 서버 오늘이 아니라 조회 중인 날짜 기준이어야 그 날짜 이후 회차를 '직전'으로 잘못 표시하지 않음.
  // 보강 행의 과목 = 강사 담당 반의 과목들(buildMakeupStudent와 같은 규약) — 아래 prevScore 게이트가 쓴다. 독립 조회라 병렬(B4).
  const [{ data }, myClasses] = await Promise.all([
    supabase
      .from("lesson_reports")
      .select("report_date, subject, progress, exam_info, textbook, homework_today, homework_score, attitude, notes")
      .eq("student_id", studentId)
      .lt("report_date", resolveReportDate(reportDate))
      .order("report_date", { ascending: false })
      .limit(50),
    // 과목 판정은 buildMakeupStudent와 같은 소스(담당 ∪ 그날 위임) — 갈라지면 추가된 행과 '이전 진도' 과목이 어긋난다.
    getTeachingClasses(supabase, user.id, resolveReportDate(reportDate)),
  ]);
  const rows = data ?? [];
  const subjectKeys = [...new Set(myClasses.map((c) => c.subject).filter(Boolean) as string[])];

  const bySubject: Record<string, { prev: string; prevReport: PrevReport }> = {};
  for (const r of rows) {
    const key = (r.subject as string | null) ?? "";
    if (key in bySubject) continue; // report_date desc라 (과목) 첫 건이 직전 회차
    const label = subjectMaps.labelOf(key);
    const rawProg = r.progress as string | null;
    // 저장 progress는 "라벨 + 진도"라 라벨 접두를 벗겨 깨끗한 이전 진도 텍스트로.
    const prog =
      rawProg && label && rawProg.startsWith(label)
        ? rawProg.slice(label.length).trim() || rawProg
        : rawProg;
    bySubject[key] = {
      prev: prog ?? "",
      prevReport: {
        date: r.report_date as string,
        progress: prog ?? null,
        textbook: (r.textbook as string | null) ?? null,
        homeworkToday: (r.homework_today as string | null) ?? null,
        homeworkScore: (r.homework_score as string | null) ?? null,
        attitude: (r.attitude as string | null) ?? null,
        examInfo: (r.exam_info as string | null) ?? null,
        note: (r.notes as string | null) ?? null,
      },
    };
  }
  // prevScore = 학생 단위 최신 직전 회차의 exam_info — 단 **이 강사가 가르치는 과목**의 회차만
  //    (2026-07-29). 과목 무관으로 두면 영어 강사의 보강 학생에게 수학 회차 점수가 '지난 회차'로 잡혀
  //    DeltaChip이 엉뚱한 증감(▲▼)을 띄운다. roster.ts의 학생단위 폴백 게이트와 한 쌍.
  const mySubjects = new Set(subjectKeys);
  const first = rows.find((r) => mySubjects.has(reportSubject({ subject: r.subject as string | null })));
  const prevScore = first ? parseExamScores(first.exam_info as string | null) : { daily: null, check: null };
  return { ok: true, bySubject, prevScore };
}

/**
 * 학부모 미리보기용 **성적 추이 이력** — 카드 뷰에서 선택된 (학생, 과목) 1건만 지연 조회한다.
 *
 * 🔴 로스터(첫 페인트)에 싣지 않는 이유: 원스크린은 전원이 매일 여는 경로고, 추이는 **학생마다** 별도
 *    조회가 필요하다(30일 창 + 최근 7건). 로스터에 넣으면 학생 수만큼 왕복이 붙는다(B2·B4).
 *    선택된 학생 1명분만, 카드를 열 때 뒤늦게 채운다 → 첫 페인트 비용 0.
 * ⚠️ 표본은 /r·인쇄와 **같은 함수**(fetchReportTrendRows)로 잡는다 — 미리보기 그래프가 발송본과
 *    다른 표본을 그리면 미리보기의 의미가 없다(정규/특강 분리 축까지 동일).
 * 스코프는 형제 읽기 액션(loadMakeupHistory)과 같은 기준 — 로그인 + RLS 테넌트 격리.
 */
export async function loadReportTrend(
  studentId: string,
  subject: string | null,
  classId: string | null,
  reportDate?: string,
): Promise<{ ok: boolean; rows?: TrendReportRow[]; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!studentId) return { ok: false, error: "학생 정보가 없습니다" };
  const supabase = await createClient();
  const date = resolveReportDate(reportDate);
  try {
    const specialClassIds = await fetchSpecialClassIds(supabase).catch(() => [] as string[]);
    const rows = await fetchReportTrendRows(supabase, studentId, subject, date, {
      classId,
      specialClassIds,
    });
    return { ok: true, rows };
  } catch {
    // 미리보기 보조 데이터라 실패해도 화면을 막지 않는다(그래프만 빈다).
    return { ok: false, error: "추이를 불러오지 못했습니다" };
  }
}
