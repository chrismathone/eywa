"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday, resolveReportDate } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { commentBody, commentP1Body, commentP2Body, type ReportCommentInput } from "../report-comment";
import { buildTrendInput, trendBody } from "../trend-comment";
import { assembleCombined, MENT_AI_TUNING, type PromptSection } from "../prompt-defaults";
import { loadActivePrompt } from "./prompt-loader";
import { fetchScoreHistory, hasLaterScoredReport } from "./score-history";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "../classnote-guard";
import { hasClassnoteNameCollision, teacherOwnsStudent } from "./scope";
import { ingestReport } from "@/features/progress/server/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTextbookOrdersForStudents } from "@/features/billing/server/textbook-queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { parseExamScores } from "../exam-info";
import type { OneScreenStudent, PrevReport } from "../types";

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
  subject?: string; // 과목키(math/english…) — (student,date,subject) 과목별 1행 dedup용
  // 보강·수업외 학생(수동 추가) — true면 '내 담당 반 활성 수강생' 검사 대신 같은 학원(tenant) 학생이면 허용.
  // 원장 승인 정책(보강 저장=학원 전체). RLS가 테넌트 격리(cross-tenant는 select null) → 학원 밖 학생은 여전히 거부.
  outOfClass?: boolean;
};

/**
 * 선생님 원스크린 — 수업 보고서를 lesson_reports(0049a)에 저장.
 * D3: 저장만(메시징/PDF 발송 연동은 후속 웨이브). RLS가 tenant 격리 + 앱단에서 강사 스코프 이중 방어
 * (보고서를 쓰려는 학생이 그 강사 담당 반의 활성 수강생이 아니면 거부 — 다른 반 학생에 임의 기록 차단).
 */
export async function saveLessonReport(
  input: SaveLessonReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
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
    const { data: myClasses } = await supabase
      .from("classes")
      .select("id")
      .eq("teacher_id", user.id);
    const myClassIds = (myClasses ?? []).map((c) => c.id);
    if (myClassIds.length === 0) return { ok: false, error: "담당 반이 없습니다" };

    const { data: enr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", input.studentId)
      .or(`start_date.is.null,start_date.lte.${reportDate}`)
      .or(`end_date.is.null,end_date.gte.${reportDate}`)
      .in("class_id", myClassIds)
      .limit(1);
    if (!enr || enr.length === 0) return { ok: false, error: "담당 학생이 아닙니다" };
  }

  // (student, date, subject) 과목별 1행 upsert — 재발송 시 같은 행 갱신(중복 방지, 0083a 유니크).
  // share_token은 update 시 payload에 없어 미변경(안정 링크). classnote_* 도 미변경(별도 saveAndQueueClassnote가 관리).
  const { data, error } = await supabase
    .from("lesson_reports")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: input.studentId,
        report_date: reportDate,
        subject: input.subject || null,
        textbook: input.textbook || null,
        makeup: input.makeup ?? false,
        homework_today: input.homeworkToday || null,
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: input.homeworkScore || null,
        daily_test: input.dailyTest || null,
        check_test: input.checkTest || null,
        attitude: input.attitude || null,
        teacher_name: user.displayName ?? null,
        notes: input.notes || null,
        trend_note: input.trendNote || null,
        source: "onescreen",
      },
      { onConflict: "tenant_id,student_id,report_date,subject" },
    )
    .select("id, share_token")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };

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
    });
  } catch {
    /* 진도 반영 실패는 보고서 저장을 막지 않음 */
  }

  return { ok: true, id: data.id, shareToken: data.share_token };
}

/**
 * 원스크린 "ClassNote 발송" — 보고서 저장(upsert) + ClassNote 큐 적재를 한 액션으로.
 * 강사는 큐에 넣고 즉시 반환(비동기) — 실제 게시는 로컬 워커가 폴링해 처리(P3).
 *
 * 재발송 정책(리뷰 반영): **저장 전** 기존 상태를 확인한다.
 * - `processing`(워커가 게시 중) → 내용을 덮어쓰지 않고 반환(레이스·오게시 방지).
 * - 그 외(null/queued/success/failed) → upsert 후 `queued`로 재적재 → **재발송 허용**(강사의 발송 재클릭 = 재게시 의도).
 *   기존엔 저장을 먼저 해 내용은 바뀌고 success면 재큐잉을 막아 ClassNote와 불일치가 났음.
 */
export async function saveAndQueueClassnote(
  input: SaveLessonReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; status?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };

  const supabase = await createClient();
  // 대상 날짜 = 고른 날짜 클램프(saveLessonReport와 동일 계산 → pre-read·too_old 게이트가 그 날짜 기준).
  const reportDate = resolveReportDate(input.reportDate);

  // 저장 전 상태 pre-read((student,date,subject) 행). RLS로 테넌트 격리.
  const base = supabase
    .from("lesson_reports")
    .select("id, classnote_status, revoked_at")
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate);
  const { data: prior } = await (
    input.subject ? base.eq("subject", input.subject) : base.is("subject", null)
  ).maybeSingle();
  // 취소된 링크는 재큐잉 안 함 — 옛 링크가 死링크라 재발송하려면 먼저 재발급(새 토큰·취소 해제)해야 함.
  if (prior?.revoked_at) {
    return { ok: true, id: prior.id, status: "revoked" };
  }
  // 워커 게시 중이면 내용 덮어쓰지 않고 그대로 반환(in-flight 보호).
  if (prior?.classnote_status === "processing") {
    return { ok: true, id: prior.id, status: "processing" };
  }

  // 저장(upsert) — 권한 재검증(getCurrentUser+담당 활성수강생)은 saveLessonReport 내부.
  const saved = await saveLessonReport(input);
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };

  // 발송 안전 스위치 — 기본 OFF(dry-run). 원장이 승인(설정 토글)하기 전까지 **저장만** 하고 실제 큐잉(발송) 안 함.
  // 공유 DB + 라이브 워커라 승인 전 실발송 방지(classnote_status 미변경 → 워커가 안 잡음).
  const settings = await getTenantSettings();
  if (!settings.report.classnoteSendEnabled) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "dry_run" };
  }

  // 과목별 발송 게이트 — 학원설정 발송 허용 과목(현 운영=수학만)에 없으면 저장만 하고 큐잉 안 함(오발송 방지).
  if (!isClassnoteSubjectEnabled(input.subject, settings.report.classnoteSubjects)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "subject_off" };
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
      .eq("id", saved.id);
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "name_conflict" };
  }

  // too_old(전 달 1일 이전) 아니면 queued로 재적재(재발송). 오늘 저장은 항상 통과하나 규약상 명시.
  const allowed = isClassnoteAllowed(reportDate);
  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: allowed ? "queued" : "too_old",
      classnote_queued_at: allowed ? new Date().toISOString() : null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .eq("id", saved.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: saved.id, shareToken: saved.shareToken, status: allowed ? "queued" : "too_old" };
}

/**
 * 공유 링크 취소(revoke) — 강사가 학부모 공개 링크(/r/[token]) 열람을 즉시 차단(오발송 회수).
 * 링크·토큰은 유지하되 revoked_at을 세워 /r이 취소화면을 렌더. 대상은 share_token으로 식별(전역 유니크).
 */
export async function revokeShareLink(shareToken: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!shareToken) return { ok: false, error: "링크 정보가 없습니다" };
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("lesson_reports")
    .select("id, student_id")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!report) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  if (!(await teacherOwnsStudent(supabase, user.id, report.student_id)))
    return { ok: false, error: "담당 학생이 아닙니다" };
  const { error } = await supabase
    .from("lesson_reports")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", report.id);
  if (error) return { ok: false, error: error.message };
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
  if (!shareToken) return { ok: false, error: "링크 정보가 없습니다" };
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("lesson_reports")
    .select("id, student_id")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!report) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  if (!(await teacherOwnsStudent(supabase, user.id, report.student_id)))
    return { ok: false, error: "담당 학생이 아닙니다" };
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
  if (error) return { ok: false, error: error.message };
  return { ok: true, shareToken: newToken };
}

export type SaveOnescreenSessionInput = {
  studentId: string;
  sessionDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 작업분을 그 날짜 세션에 저장(report_date와 동일 기준).
  classId?: string | null;
  studyGrade?: string | null;
  subjectProgress?: Record<
    string,
    { today?: string; draft?: string; trendDraft?: string; textbook?: string; makeup?: boolean; homeworkToday?: string }
  >;
  dailyScore?: number | null;
  dailyMax?: number | null;
  checkScore?: number | null;
  checkMax?: number | null;
  attitude?: string | null;
  homework?: string | null;
  note?: string | null; // 특이사항(강사 메모) — 0093a
  progressConfirmed?: boolean;
};

/**
 * 선생님 원스크린 "오늘 작업중" 상태를 onescreen_daily_sessions(0065a)에 upsert.
 * 강사가 입력한 점수/진도/태도/과제/진도확정이 새로고침·재접속에도 유지되도록 서버 영속.
 * saveLessonReport와 동일한 auth + 강사 스코프 이중 방어(담당 반 활성 수강생만). 하루 1행(upsert).
 */
export async function saveOnescreenSession(
  input: SaveOnescreenSessionInput,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };

  const supabase = await createClient();

  const sessionDate = resolveReportDate(input.sessionDate);
  const { data: myClasses } = await supabase.from("classes").select("id").eq("teacher_id", user.id);
  const myClassIds = (myClasses ?? []).map((c) => c.id);
  if (myClassIds.length === 0) return { ok: false, error: "담당 반이 없습니다" };

  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", input.studentId)
    .or(`start_date.is.null,start_date.lte.${sessionDate}`)
    .or(`end_date.is.null,end_date.gte.${sessionDate}`)
    .in("class_id", myClassIds)
    .limit(1);
  if (!enr || enr.length === 0) return { ok: false, error: "담당 학생이 아닙니다" };

  // ⚠️ 강사축(0118a): onConflict에 updated_by(=강사)를 포함 — 같은 학생을 다른 강사가 같은 날 가르쳐도
  //    각자 1행이라 subject_progress·점수·태도가 서로 안 덮인다(WIP 유실 방지). roster는 updated_by=본인만 복원.
  const { error } = await supabase.from("onescreen_daily_sessions").upsert(
    {
      tenant_id: user.tenantId,
      student_id: input.studentId,
      session_date: sessionDate,
      class_id: input.classId ?? null,
      study_grade: input.studyGrade ?? null,
      subject_progress: input.subjectProgress ?? {},
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
    },
    { onConflict: "tenant_id,updated_by,student_id,session_date" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * AI 학부모 멘트 + 학습 추세 자동작성 — edutrix generateDailyNotice/generateTrendAnalysis 이식.
 * **통합 1회 호출**: 활성 프롬프트(모드 A=멘트, B=P1·P2)와 추세(표본 충분 시)를 하나의 멀티출력 프롬프트로
 * 조립해 generateJSON을 한 번만 호출한다(학생당 2~3회 → 1회, 비용·지연↓). 프롬프트는 여전히 문구별 편집 가능.
 * trendCtx 주면 추세도 함께 생성해 반환. DB 미변경 → 로그인만 확인. 실패 시 ok:false → 클라 템플릿 폴백.
 */
export async function generateReportComment(
  input: ReportCommentInput,
  trendCtx?: { studentId?: string; subject?: string; todayExamInfo?: string; todayHomework?: string; date?: string },
): Promise<{ ok: boolean; comment?: string; trend?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // 방지로직 — 진도/태도/테스트/과제 등 최소 사실이 하나도 없으면 생성 거부(빈 껍데기 멘트 방지).
  // 개별 자동작성 버튼은 클라에서 진도 없으면 비활성이지만, 서버에서도 이중 방어(edutrix 관례).
  const hasFacts = !!(
    input.progress?.trim() ||
    input.attitude?.trim() ||
    input.dailyTest?.trim() ||
    input.checkTest?.trim() ||
    input.homework?.trim() ||
    input.homeworkToday?.trim() ||
    input.specialNote?.trim()
  );
  if (!hasFacts) return { ok: false, error: "진도·태도 등을 입력한 뒤 자동작성할 수 있습니다" };
  try {
    const supabase = await createClient();
    const settings = await getTenantSettings();
    // 멘트 모드 — 강사 본인 오버라이드(users.report_notice_mode) > 학원 기본(report.noticeMode) > 'A'.
    const { data: meRow } = await supabase
      .from("users")
      .select("report_notice_mode")
      .eq("id", user.id)
      .single();
    const mode = (meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? settings.report.noticeMode ?? "A";

    const sections: PromptSection[] = [];
    // 멘트 섹션 — 모드 A=단일(사실+특이사항 종합), B=수업내용(P1)+태도·특이사항(P2). 사실 없는 문단은 생략.
    if (mode === "B") {
      const [p1tpl, p2tpl] = await Promise.all([
        loadActivePrompt(supabase, user.tenantId, "comment_p1"),
        loadActivePrompt(supabase, user.tenantId, "comment_p2"),
      ]);
      const p1 = commentP1Body(input, p1tpl);
      const p2 = commentP2Body(input, p2tpl);
      if (p1) sections.push({ type: "comment_p1", field: "p1", body: p1 });
      if (p2) sections.push({ type: "comment_p2", field: "p2", body: p2 });
    } else {
      const tpl = await loadActivePrompt(supabase, user.tenantId, "comment"); // DB 활성값 > 기본
      sections.push({ type: "comment", field: "comment", body: commentBody(input, tpl) });
    }

    // 추세 섹션(선택) — 컨텍스트 있고 표본 충분할 때만. 대상 날짜(작업중, 미저장일 수 있음) 포함(edutrix 패리티).
    // ⚠️ 과거 날짜 보고서: 그 뒤에 이미 채점 이력이 있으면 추세 미반영 — 뒤늦게 끼우는 과거 점이 추세 그래프/서술을 흐트러뜨림(원장 2026-07-14).
    let hasTrend = false;
    if (trendCtx?.studentId) {
      const anchorDate = resolveReportDate(trendCtx.date); // 대상 날짜(빈값·미래→오늘)
      const skipTrend =
        anchorDate < kstToday() && (await hasLaterScoredReport(supabase, trendCtx.studentId, trendCtx.subject, anchorDate));
      if (!skipTrend) {
        const history = await fetchScoreHistory(supabase, trendCtx.studentId, trendCtx.subject, anchorDate);
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
      meta: { feature: "classnote_ment" },
      ...MENT_AI_TUNING,
    });
    const pick = (k: string) => (data[k] ?? "").trim();
    const comment = mode === "B" ? [pick("p1"), pick("p2")].filter(Boolean).join("\n\n") : pick("comment");
    if (!comment) return { ok: false, error: "빈 응답" };
    const trend = hasTrend ? pick("trend") || undefined : undefined;
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
  if (mode !== null && mode !== "A" && mode !== "B") return { ok: false, error: "잘못된 모드입니다" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ report_notice_mode: mode })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

  const [{ data: myClasses }, orders] = await Promise.all([
    supabase.from("classes").select("subject").eq("teacher_id", user.id).eq("is_active", true),
    getTextbookOrdersForStudents([studentId]),
  ]);
  const subjectKeys = [...new Set((myClasses ?? []).map((c) => c.subject).filter(Boolean) as string[])];
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
  const targetDate = resolveReportDate(reportDate);
  const { data: todayReports } = await supabase
    .from("lesson_reports")
    .select("subject, share_token, classnote_status, revoked_at, attachments")
    .eq("student_id", studentId)
    .eq("report_date", targetDate);
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
        textbook: book,
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
 * prevScore(일일/확인)는 학생 단위 최신 회차의 exam_info로.
 */
export async function loadMakeupHistory(studentId: string): Promise<{
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

  // 오늘 이전(직전) 보고서만, 최신순. RLS가 테넌트 격리. 한 학생이라 limit 소량.
  const { data } = await supabase
    .from("lesson_reports")
    .select("report_date, subject, progress, exam_info, textbook, homework_today, homework_score, attitude, notes")
    .eq("student_id", studentId)
    .lt("report_date", kstToday())
    .order("report_date", { ascending: false })
    .limit(50);
  const rows = data ?? [];

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
  // prevScore = 학생 단위 최신 직전 회차의 exam_info(과목 무관, DeltaChip 폴백과 동일).
  const first = rows[0];
  const prevScore = first ? parseExamScores(first.exam_info as string | null) : { daily: null, check: null };
  return { ok: true, bySubject, prevScore };
}
