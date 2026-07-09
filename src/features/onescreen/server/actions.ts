"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { commentBody, commentP1Body, commentP2Body, type ReportCommentInput } from "../report-comment";
import { buildTrendInput, trendBody } from "../trend-comment";
import { assembleCombined, MENT_AI_TUNING, type PromptSection } from "../prompt-defaults";
import { loadActivePrompt } from "./prompt-loader";
import { fetchScoreHistory } from "./score-history";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isClassnoteAllowed } from "../classnote-guard";
import { hasClassnoteNameCollision, teacherOwnsStudent } from "./scope";
import { ingestReport } from "@/features/progress/server/ingest";

export type SaveLessonReportInput = {
  studentId: string;
  textbook?: string; // 교재명 — 0089a(학부모 카드 showTextbook)
  makeup?: boolean; // 보강 수업 여부 — 0089a
  progress: string; // "영어 Unit 8 · p.90"
  examInfo: string; // "일일 18/20, 확인 19/20" (roster prev-score 파싱용 합본 — 보존)
  homeworkScore: string; // 과제 상태
  notes: string; // 학부모 보고서 본문
  dailyTest?: string; // "20문제 중 18개" (학부모 보고서 일일테스트 표시용)
  checkTest?: string; // "20문제 중 19개"
  attitude?: string; // "좋음"
  trendNote?: string; // 학습 추세(종합분석) 문구 — 0091a. 멘트(notes)와 별개 저장·표시.
  subject?: string; // 과목키(math/english…) — (student,date,subject) 과목별 1행 dedup용
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

  // 강사 스코프: 이 학생이 내 담당 반의 활성 수강생인지 확인.
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
    .is("end_date", null)
    .in("class_id", myClassIds)
    .limit(1);
  if (!enr || enr.length === 0) return { ok: false, error: "담당 학생이 아닙니다" };

  // KST 오늘 — Vercel UTC 오전에 report_date가 하루 밀리는 것 방지(saveOnescreenSession·too_old 가드와 동일 기준).
  const reportDate = kstToday();

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
  const reportDate = kstToday();

  // 저장 전 상태 pre-read(오늘 (student,subject) 행). RLS로 테넌트 격리.
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
  classId?: string | null;
  studyGrade?: string | null;
  subjectProgress?: Record<string, { today?: string; draft?: string; textbook?: string; makeup?: boolean }>;
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

  const { data: myClasses } = await supabase.from("classes").select("id").eq("teacher_id", user.id);
  const myClassIds = (myClasses ?? []).map((c) => c.id);
  if (myClassIds.length === 0) return { ok: false, error: "담당 반이 없습니다" };

  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", input.studentId)
    .is("end_date", null)
    .in("class_id", myClassIds)
    .limit(1);
  if (!enr || enr.length === 0) return { ok: false, error: "담당 학생이 아닙니다" };

  const { error } = await supabase.from("onescreen_daily_sessions").upsert(
    {
      tenant_id: user.tenantId,
      student_id: input.studentId,
      session_date: kstToday(),
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
    { onConflict: "tenant_id,student_id,session_date" },
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
  trendCtx?: { studentId?: string; subject?: string; todayExamInfo?: string; todayHomework?: string },
): Promise<{ ok: boolean; comment?: string; trend?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  try {
    const supabase = await createClient();
    const settings = await getTenantSettings();
    const mode = settings.report.noticeMode ?? "A";

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

    // 추세 섹션(선택) — 컨텍스트 있고 표본 충분할 때만. 오늘(작업중, 미저장일 수 있음) 포함(edutrix 패리티).
    let hasTrend = false;
    if (trendCtx?.studentId) {
      const history = await fetchScoreHistory(supabase, trendCtx.studentId, trendCtx.subject, kstToday());
      history.push({
        date: kstToday(),
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

    if (sections.length === 0) return { ok: false, error: "생성할 내용이 없습니다" };

    // 통합 1회 호출 — 멘트(·추세)를 한 번에 {comment|p1|p2, trend}로 생성. Solar 후보정(temp 0.3·reasoning minimal) 적용.
    const { data } = await generateJSON<Record<string, string>>({
      prompt: assembleCombined(sections),
      maxTokens: 1000,
      keyName: "default",
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
