"use server";

import { normalizeNoneMarker } from "../none-marker";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { preserveMakeupSessionEntries, type SessionProgress } from "../makeup-session";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { addDays, kstToday, resolveReportDate } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { commentBody, commentP1Body, commentP2Body, type ReportCommentInput } from "../report-comment";
import { buildTrendInput, findImpossibleScaleSpans, trendBody } from "../trend-comment";
import {
  assembleCombined,
  commentStyleDirective,
  MENT_AI_TUNING,
  type PromptSection,
} from "../prompt-defaults";
import { loadActivePrompt } from "./prompt-loader";
import {
  fetchReportTrendRows,
  fetchScoreHistory,
  fetchSpecialClassIds,
  hasLaterScoredReport,
} from "./score-history";
import type { TrendReportRow } from "../report-trend";
import { getTenantSettings } from "@/features/owner/server/queries";
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
import { ingestReport } from "@/features/progress/server/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
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
import { resolveMentSource, type MentSource } from "../ment-source";
import { mentSourceColumnReady } from "./ment-source-db";
import { loadTeacherMentStyle } from "./ment-style-db";
import { mentStyleDirective } from "../ment-style-prompt";
import { prependParentAddress, splitParentAddress } from "../parent-address";
import { logAction } from "@/features/audit/server/log";
import { isSlotOnlyEnglishNotes, shouldCaptureJj } from "../jj-capture-plan";
import { classRouteActive, needsSendClass, NO_SEND_CLASS_ERROR, SEND_CLASS_SUBJECTS } from "../send-class";
import { classBoardLiveForStudent, resolveSendClass } from "./send-class";
import { captureReportJj } from "./jj-capture";
import type { OneScreenStudent, PrevReport } from "../types";
import { humanizeDbError } from "@/lib/supabase/db-error";

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
  /**
   * 영어 결과지 고르기(2026-09-28) — 그림 칸 `[시험결과지]`에 붙일 인재원 응시 id. `undefined` = 이 보고서에 저장해 둔
   * 고르기를 따른다(일괄 발송·옛 화면처럼 고르기를 모르는 경로가 고른 것을 풀지 않게), `null` = 기본(그날 낸 시험 전부).
   * 응시가 이 학생 것인지는 서버가 다시 확인한다(ijw/server/report-snapshot.ts).
   */
  jjExamPick?: string[] | null;
  /**
   * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'(0303a) — 반별 발송 대상일 때 화면이 고른 반.
   * 없으면 서버가 메인 수업을 정한다(send-class). 서버가 후보 안에 있는지 다시 확인한다.
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
}> {
  const user = await getCurrentUser();
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
  const mentReady = await mentSourceColumnReady(supabase);
  const gateBase = supabase
    .from("lesson_reports")
    // 멘트 작성 방식 판정 재료(notes, ment_source)를 게이트 pre-read에 **합승**시킨다 — 별도 왕복 없음(B4).
    .select(mentReady ? "id, classnote_status, notes, ment_source" : "id, classnote_status")
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
    | { id: string; classnote_status: string | null; notes?: string | null; ment_source?: string | null }
    | undefined;
  if (priorRow?.classnote_status === "success") {
    return {
      ok: false,
      id: priorRow.id,
      error: "이미 학부모에게 발송된 보고서라 수정할 수 없습니다 — 고쳐야 하면 공유링크를 재발급하세요",
    };
  }

  // (student, date, 반|과목) 1행 upsert — 재저장 시 같은 행 갱신(0134a `unit_key` 유니크).
  // ⚠️ onConflict 타깃은 **생성열 unit_key**(= coalesce(class_id::text, subject)) — 부분·표현식 인덱스는
  //    supabase-js upsert가 타깃으로 못 잡아서(0083a 교훈) 생성열로 평범한 컬럼처럼 만들어 둔 것이다.
  // share_token은 update 시 payload에 없어 미변경(안정 링크). classnote_* 도 미변경(별도 saveAndQueueClassnote가 관리).
  const { data, error } = await supabase
    .from("lesson_reports")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: input.studentId,
        report_date: reportDate,
        subject: input.subject || null,
        class_id: input.classId || null,
        textbook: input.textbook || null,
        makeup: input.makeup ?? false,
        // 자유입력 자리표시자(`-`·`X` 등)를 "없음" 하나로 표준화(none-marker.ts 규약, 원장 2026-07-23) —
        // 그대로 두면 학부모 카드에 "오늘 과제: -"가 나가고 AI 멘트가 그걸 사실로 받는다.
        homework_today: normalizeNoneMarker(input.homeworkToday),
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: normalizeNoneMarker(input.homeworkScore),
        // 보강 행일 때만 앵커를 남긴다(정규 행에 들어가면 필터가 엉킨다). 미지정('전체'에서 추가)은 null.
        makeup_class_id: input.makeup && !input.classId ? (input.makeupClassId ?? null) : null,
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
        // 멘트 작성 방식(0214a) — 클라 판정 + 기존 라벨 sticky 합산(ment-source.ts). 컬럼 없으면 통째 생략(#95).
        ...(mentReady
          ? {
              ment_source: resolveMentSource({
                client: input.mentSource,
                prevSource: priorRow?.ment_source,
                prevNotes: priorRow?.notes,
                nextNotes: input.notes,
              }),
            }
          : {}),
      },
      { onConflict: "tenant_id,student_id,report_date,unit_key" },
    )
    // teacher_name은 진도 점프 경고의 "같은 선생님" 축(2026-08-20) — 넘길 값을 여기서 다시 조립하지 말고
    // **저장된 그 값**을 되받는다(갱신 시 DB가 원 작성자를 보존하는 경로가 있어 화면 값과 갈릴 수 있다).
    // created_by도 되받는다 — 보강 출석부 칸의 **귀속 강사**(아래 훅)는 저장자가 아니라 이 소유 계정이다.
    .select("id, share_token, teacher_name, created_by")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };

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
   * **보강 보고서를 쓰면 출석부에 칸이 선다**(원장 2026-09-02: *"보고서 발송건에 대해서는 자동 입력
   * 되어야지"* · *"실제로 수업을 했는데 출석부에 시수가 없으면 이상하지"*).
   *
   * 🔴 **반 없는 보강만**이다(`makeup && !classId`). 반이 붙은 보고서는 그 반 출석부에 이미 칸이 있다.
   * 🔴 ~~어느 반에서 했는지는 묻지 않는다~~ → **2026-09-21 원장이 뒤집었다**(*"보강 추가시에 '수업'을 선택할 수 있어야겠어.
   *    그냥 보강으로 추가되니까 출석부에 행만 자꾸 생기네"*): 확인창이 수업을 묻고 그 반이 `makeupClassId`로 온다 — 그 반에 칸이
   *    이미 서 있으면 여기서 아무것도 안 만든다. '반 없이'를 고르면 종전대로 그 강사의 **보이지 않는 '보강' 반**
   *    ([`makeup-pool.ts`](@/features/classes/makeup-pool))에 앉힌다. 그래야 시수 주인이 생긴다.
   * 🔴 **귀속은 저장자가 아니라 보고서의 소유자**(저장된 행의 `created_by` → `teacher_name`, 규칙은
   *    `pickMakeupOwner`). 사무실이 강사 대신 저장하면 저장자로 귀속했을 때 보강 반이 사무실 계정 앞으로
   *    생겨 그 강사 출석부엔 안 뜬다(2026-09-02 점검 — 실측 0건이라 예방). 소유자를 계정으로 못 풀면
   *    (동명이인·미등록) **훅을 건너뛴다** — 소급 스크립트가 같은 규칙으로 채울 수 있다.
   * ⚠️ 있는 칸은 안 덮는다 · 실패해도 보고서 저장은 그대로다(출결은 보고서 위의 기록이다).
   */
  if (input.makeup && !input.classId) {
    try {
      const owner = await resolveMakeupOwner({
        tenantId: user.tenantId,
        createdBy: (data.created_by as string | null | undefined) ?? null,
        teacherName: data.teacher_name ?? null,
        saver: { id: user.id, name: user.displayName ?? null },
      });
      if (owner) {
        await ensureMakeupAttendanceForReport({
          tenantId: user.tenantId,
          teacherId: owner.id,
          teacherName: owner.name,
          studentId: input.studentId,
          subject: input.subject || LEGACY_REPORT_SUBJECT,
          date: reportDate,
          // 확인창에서 고른 수업(또는 반 필터) — 그 반에 칸이 이미 서 있으면 보강 반을 만들지 않는다(시수 두 번 방지).
          makeupClassId: input.makeupClassId ?? null,
        });
      }
    } catch {
      /* 출결 칸 생성 실패는 보고서 저장을 막지 않는다(로그는 헬퍼가 남긴다) */
    }
  }

  /**
   * 감사로그 — **누가 이 보고서를 고쳤나**의 유일한 근거다.
   * 🔴 `lesson_reports`에는 `updated_by`가 없고, `created_by`는 갱신 때 DB 트리거가 **원 작성자를
   *    보존**한다(위 upsert 주석). 즉 사무실이 남의 보고서를 고쳐도 행에는 흔적이 안 남는다.
   * ⚠️ 본문(notes)·특이사항은 **담지 않는다** — 학생 사적 내용이고, id·날짜·반이면 그 행을 되짚는다.
   * ⚠️ 발송(`saveAndQueueClassnote`)은 이 함수를 그대로 거치므로 저장 1줄 + 발송 1줄이 남는다
   *    (같은 보고서 id로 이어 읽힌다 — 발송이 내용까지 바꿨다는 사실이 저장 줄에 남아야 한다).
   */
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
    },
  });

  const warning = jjCapture ? await jjCapture : null;
  return { ok: true, id: data.id, shareToken: data.share_token, ...(warning ? { warning } : {}) };
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
  /** status="needs_class"일 때 — 고를 수 있는 반(반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'). */
  candidates?: { id: string; name: string }[];
}> {
  const user = await getCurrentUser();
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
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };
  // 저장 단계 알림(영어 그림 자료) — 아래 어느 결과로 끝나든 함께 돌려준다(저장은 이미 끝났다).
  const warn = saved.warning ? { warning: saved.warning } : {};

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
      return { ok: false, error: "출결 확인에 실패해 발송하지 않았습니다 — 저장은 완료됐어요. 다시 시도해 주세요" };
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

  // 반별 발송(보고서 설정 '수학 발송 경로') 대상인데 **보낼 반 보드가 없는** 보고서 — 'ClassNote로 보낼 반'을 정한다(0303a).
  //  · 반이 없는 보강(A안, 2026-09-29) · 반은 있지만 이 학생이 받을 반 보드가 없는 반 — ClassNote에서 사라진 종강 반 등
  //    (원장 2026-09-30 *"종강은 클래스노트에 반이 살아있는 한은 계속 보내고, 이후에 반이 사라지면 반 선택이 뜨도록"*).
  //    특강은 정규 반처럼 제 반 보드로 간다(원장 2026-09-30 — 특강 반 보드도 만든다).
  // 메인 수업을 정할 수 있으면 그 반, 못 정하면 **발송을 멈추고 후보를 돌려준다**(화면이 고르게 한다).
  // 🔴 후보가 아예 없으면 **발송하지 않는다**(원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*) — 예전엔 1인 보드로 보냈다.
  const routeApplies = classRouteActive(settings, user.displayName); // ClassNote 모듈이 꺼진 학원은 언제나 false(예전 그대로)
  const classLive =
    routeApplies && input.classId && SEND_CLASS_SUBJECTS.has(input.subject ?? "")
      ? await classBoardLiveForStudent(user.tenantId, input.classId, input.studentId).catch(() => null)
      : null;
  // 반 보드 확인 실패(0302a 조회 오류 등) = **발송하지 않는다**(fail-closed) — 모르는 채로 보내면 워커가 1인 보드로 흘린다.
  const classCheckFailed = routeApplies && !!input.classId && SEND_CLASS_SUBJECTS.has(input.subject ?? "") && classLive === null;
  if (classCheckFailed || needsSendClass({ subject: input.subject, classId: input.classId, classLive }, routeApplies)) {
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
    if (classCheckFailed) {
      await unqueue();
      return checkFail;
    }
    let pick: Awaited<ReturnType<typeof resolveSendClass>>;
    try {
      // 후보 = 작성 강사가 담당하는 반만(원장 2026-09-29) — 강사는 담당 반이 없으면 발송 불가(no_class), 관리자는 담당 반이 없으면 전부.
      const restrict = (await accessLevelTenant(user.systemRole, "classes")) === "scoped";
      // 보고서에 반이 있는데 그 반 보드가 없으면(특강·종강 등) 다른 반으로 자동으로 보내지 않는다 — 고르게 한다.
      pick = await resolveSendClass(
        user.tenantId,
        input.studentId,
        reportDate,
        input.classnoteClassId ?? null,
        { userId: user.id, restrict },
        { autoPick: !input.classId },
      );
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
        error: "보낼 반을 골라 주세요 — 저장은 됐습니다",
        ...warn,
      };
    }
    // 🔴 후보가 없으면(담당 반 아님·반 보드 있는 반이 없음) 발송 불가 — 저장은 그대로, 대기에 올리지 않는다.
    if (!pick.ok) {
      await unqueue();
      return { ok: false, id: saved.id, shareToken: saved.shareToken, status: "no_class", error: NO_SEND_CLASS_ERROR, ...warn };
    }
    {
      const { error: scErr } = await supabase
        .from("lesson_reports")
        .update({ classnote_class_id: pick.classId })
        .eq("id", saved.id);
      if (scErr) {
        await unqueue();
        return {
          ok: false,
          id: saved.id,
          shareToken: saved.shareToken,
          error: "보낼 반을 저장하지 못해 발송하지 않았습니다 — 저장은 됐습니다. 관리자에게 알려 주세요",
          ...warn,
        };
      }
    }
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
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송 요청") };
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
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
      textbook?: string;
      makeup?: boolean;
      homeworkToday?: string;
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
  const user = await getCurrentUser();
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
  if (priorError) return { ok: false, error: "임시저장을 확인하지 못했습니다" };
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
  trendCtx?: { studentId?: string; subject?: string; classId?: string | null; todayExamInfo?: string; todayHomework?: string; date?: string },
  // teacherStyle=false: 사무실 대리작성(보고서 관리 > 직접 작성)이 넘긴다 — 그 멘트는 **다른 강사 이름**으로 나가는 보고서라 호출자의
  // 말투 프로파일(0262a)을 붙이면 안 된다. 스코프 판정(effectiveTeacherId)만으론 겸직 관리자가 강사뷰 쿠키를 켠 채 그 화면을 열면 새므로(재리뷰).
  opts?: { teacherStyle?: boolean },
): Promise<{ ok: boolean; comment?: string; trend?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — DB 미변경이지만 AI 호출(비용)이라 열람에서 못 누르게 한다.
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };

  // 학부모께 직접 드리는 사과·양해 문장(특이사항·반 전체 안내)은 AI에 주지 않고 멘트 맨 앞에 그대로 붙인다
  // (2026-09-22 강사 제보 — '인사말·날짜 금지'에 걸려 모델이 때때로 뺐다, parent-address.ts 주석).
  const noteSplit = splitParentAddress(input.specialNote);
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
  };
  try {
    const supabase = await createClient();
    // 말투 프로파일(0262a)의 주인 = **이 화면의 강사 스코프**(실 강사·겸직 강사뷰 = `effectiveTeacherId`). 관리자 뷰(사무실 대리작성)는
    // 스코프가 없어(null) 프로파일을 **읽지 않는다** — 그 멘트는 다른 강사 이름으로 나가는 보고서라 사무실 계정 말투가 붙으면 안 된다.
    // 프로파일이 없거나 표가 아직 없으면(미적용) 아무것도 안 붙는다([[#95]]).
    // 멘트 모드 — 강사 본인 오버라이드(users.report_notice_mode) > 학원 기본(report.noticeMode) > 'A'.
    // 설정·모드·말투 세 조회는 서로 독립 — 직렬 워터폴 금지(B4). 겸직 강사뷰의 스코프 판정(쿠키+담당 반)도 이 안에서 돈다.
    const [settings, { data: meRow }, mentStyle] = await Promise.all([
      getTenantSettings(),
      supabase.from("users").select("report_notice_mode").eq("id", user.id).single(),
      opts?.teacherStyle === false
        ? null
        : effectiveTeacherId().then((teacherId) => (teacherId ? loadTeacherMentStyle(createAdminClient(), user.tenantId, teacherId) : null)),
    ]);
    const styleBlock = mentStyle ? mentStyleDirective(mentStyle) : "";
    const withTeacherStyle = (body: string) => (styleBlock ? `${body}\n\n${styleBlock}` : body);
    const mode = (meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? settings.report.noticeMode ?? "A";

    const sections: PromptSection[] = [];
    // 멘트 섹션 — 모드 A=단일(사실+특이사항 종합), B=수업내용(P1)+태도·특이사항(P2). 사실 없는 문단은 생략.
    if (mode === "B") {
      const [p1tpl, p2tpl] = await Promise.all([
        loadActivePrompt(supabase, user.tenantId, "comment_p1"),
        loadActivePrompt(supabase, user.tenantId, "comment_p2"),
      ]);
      const p1 = commentP1Body(safeInput, p1tpl);
      const p2 = commentP2Body(safeInput, p2tpl);
      if (p1) sections.push({ type: "comment_p1", field: "p1", body: withTeacherStyle(p1) });
      if (p2) sections.push({ type: "comment_p2", field: "p2", body: withTeacherStyle(p2) });
    } else {
      const tpl = await loadActivePrompt(supabase, user.tenantId, "comment"); // DB 활성값 > 기본
      // 문체 변형(2026-07-30) — 같은 반 학생들이 한 낱말만 다른 복사본을 받지 않게 **어디서부터 이야기를
      // 열지**를 학생·날짜별로 돌린다. 사실은 그대로, 순서·초점만 바뀐다(prompt-defaults 주석 참조).
      // 시드가 결정적이라 같은 학생·같은 날 재생성해도 결이 흔들리지 않는다.
      const styleSeed = `${input.studentName}|${trendCtx?.date ?? ""}|${input.subject}`;
      const style = commentStyleDirective(styleSeed);
      const body = commentBody(safeInput, tpl);
      // 순서가 뜻이다 — 말투 지침의 마지막 줄이 바로 위 '이번 알림장의 결'을 가리킨다(첫 문장 여는 자리는 결이 이긴다).
      sections.push({ type: "comment", field: "comment", body: withTeacherStyle(style ? `${body}

${style}` : body) });
    }

    // 추세 섹션(선택) — 컨텍스트 있고 표본 충분할 때만. 대상 날짜(작업중, 미저장일 수 있음) 포함(edutrix 패리티).
    // ⚠️ 과거 날짜 보고서: 그 뒤에 이미 채점 이력이 있으면 추세 미반영 — 뒤늦게 끼우는 과거 점이 추세 그래프/서술을 흐트러뜨림(원장 2026-07-14).
    let hasTrend = false;
    if (trendCtx?.studentId) {
      const anchorDate = resolveReportDate(trendCtx.date); // 대상 날짜(빈값·미래→오늘)
      const skipTrend =
        anchorDate < kstToday() && (await hasLaterScoredReport(supabase, trendCtx.studentId, trendCtx.subject, anchorDate));
      if (!skipTrend) {
        const specialClassIds = await fetchSpecialClassIds(supabase);
        const history = await fetchScoreHistory(supabase, trendCtx.studentId, trendCtx.subject, anchorDate, 30, {
          classId: trendCtx.classId,
          specialClassIds,
        });
        history.push({
          date: anchorDate,
          examInfo: trendCtx.todayExamInfo?.trim() || null,
          homeworkScore: trendCtx.todayHomework?.trim() || null,
        });
        const ti = buildTrendInput(history);
        if (ti) {
          const ttpl = await loadActivePrompt(supabase, user.tenantId, "trend");
          sections.push({ type: "trend", field: "trend", body: trendBody(ti, ttpl) });
          hasTrend = true;
        }
      }
    }

    if (sections.length === 0) return { ok: false, error: "생성할 내용이 없습니다" };

    // 통합 1회 호출 — 멘트(·추세)를 한 번에 {comment|p1|p2, trend}로 생성. temp 0.3·reasoning minimal(Solar 후보정) 적용.
    // 보고서 멘트·추세는 **fast tier**(Claude Haiku 4.5 / 키 죽으면 Solar 폴백) — 사실 서술형이라 Sonnet 불요, 비용 절감(원장 결정 2026-07-14).
    // ⚠️ 이 tier 지정은 **멘트 호출에만** — 등록상담·회의록 분석은 balanced(Sonnet 5) 유지. Haiku도 Anthropic 키가 살아야 동작(아니면 Solar).
    const { data } = await generateJSON<Record<string, string>>({
      prompt: assembleCombined(sections),
      maxTokens: 1000,
      keyName: "default",
      tier: "fast",
      meta: { feature: "classnote_ment", tenantId: user.tenantId },
      ...MENT_AI_TUNING,
    });
    const pick = (k: string) => (data[k] ?? "").trim();
    const aiComment = mode === "B" ? [pick("p1"), pick("p2")].filter(Boolean).join("\n\n") : pick("comment");
    if (!aiComment) return { ok: false, error: "빈 응답" };
    const comment = prependParentAddress(aiComment, parentAddress);
    // 🔴 추세 문장 후검증(2026-08-13) — 척도가 섞인 학생에게서 *"9~15문제 중 9~15개 선을 유지"* 같은
    //    **사실일 수 없는 표기**가 실제로 학부모에게 나갔다. 프롬프트 주의 문구가 이미 있었는데도 뚫렸으므로
    //    생성 뒤에도 한 번 더 본다. 걸리면 **추세를 아예 안 실는다** — 없는 것보다 거짓이 나쁘다.
    //    (추세는 선택 항목이라 빠져도 보고서는 성립한다. 멘트는 그대로 살린다.)
    const rawTrend = hasTrend ? pick("trend") || undefined : undefined;
    const badSpans = rawTrend ? findImpossibleScaleSpans(rawTrend) : [];
    if (badSpans.length)
      console.warn(
        JSON.stringify({
          level: "warn",
          scope: "generateReportComment.trend",
          reason: "impossible_scale_span",
          spans: badSpans,
          message: "추세 문장에 사실일 수 없는 척도 표기가 있어 저장하지 않음",
        }),
      );
    const trend = badSpans.length ? undefined : rawTrend;
    return { ok: true, comment, trend };
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
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
  if (readErr) return { ok: false, error: "설정을 불러오지 못했습니다" };
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
  if (error) return { ok: false, error: "설정을 저장하지 못했습니다" };

  if (!input.on) return { ok: true, cleared: 0 };
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
  return { ok: true, cleared: cleared?.length ?? 0 };
}

/** 보강(수업외) 학생 수동추가 picker — 같은 학원 재원·휴원 학생 이름검색(퇴원 제외), 최대 20건. */
export async function searchTenantStudents(
  query: string,
): Promise<{ id: string; name: string; label: string }[]> {
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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
