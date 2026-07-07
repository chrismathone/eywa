"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { buildReportCommentPrompt, type ReportCommentInput } from "../report-comment";
import { isClassnoteAllowed } from "../classnote-guard";

export type SaveLessonReportInput = {
  studentId: string;
  progress: string; // "영어 Unit 8 · p.90"
  examInfo: string; // "일일 18/20, 확인 19/20" (roster prev-score 파싱용 합본 — 보존)
  homeworkScore: string; // 과제 상태
  notes: string; // 학부모 보고서 본문
  dailyTest?: string; // "20문제 중 18개" (학부모 보고서 일일테스트 표시용)
  checkTest?: string; // "20문제 중 19개"
  attitude?: string; // "좋음"
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
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: input.homeworkScore || null,
        daily_test: input.dailyTest || null,
        check_test: input.checkTest || null,
        attitude: input.attitude || null,
        teacher_name: user.displayName ?? null,
        notes: input.notes || null,
        source: "onescreen",
      },
      { onConflict: "tenant_id,student_id,report_date,subject" },
    )
    .select("id, share_token")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };
  return { ok: true, id: data.id, shareToken: data.share_token };
}

/**
 * 원스크린 "ClassNote 발송" — 보고서 저장(upsert) + ClassNote 큐 적재를 한 액션으로.
 * 강사는 큐에 넣고 즉시 반환(비동기) — 실제 게시는 로컬 워커가 폴링해 처리(P3). 권한 재검증은 saveLessonReport가 담당.
 * 이미 queued/processing/success면 재큐잉 차단(중복 게시 방지). too_old(전 달 1일 이전) 보고서는 'too_old'로 표시만.
 */
export async function saveAndQueueClassnote(
  input: SaveLessonReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; status?: string; error?: string }> {
  const saved = await saveLessonReport(input); // 권한 재검증 + 과목별 upsert + share_token
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("lesson_reports")
    .select("classnote_status")
    .eq("id", saved.id)
    .maybeSingle();
  const cur: string | null = row?.classnote_status ?? null;
  // 이미 발송 대기/처리중/완료면 재큐잉 안 함(같은 행이라 중복 행은 애초에 불가 — 상태만 보존).
  if (cur === "queued" || cur === "processing" || cur === "success") {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: cur };
  }
  // too_old 가드 — 오늘 저장(kstToday)은 항상 통과하지만, 규약상 명시(과거보고서 오발송 사고 방지).
  if (!isClassnoteAllowed(kstToday())) {
    await supabase.from("lesson_reports").update({ classnote_status: "too_old" }).eq("id", saved.id);
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "too_old" };
  }
  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .eq("id", saved.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "queued" };
}

export type SaveOnescreenSessionInput = {
  studentId: string;
  classId?: string | null;
  studyGrade?: string | null;
  subjectProgress?: Record<string, { today?: string; draft?: string }>;
  dailyScore?: number | null;
  dailyMax?: number | null;
  checkScore?: number | null;
  checkMax?: number | null;
  attitude?: string | null;
  homework?: string | null;
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
 * AI 학부모 멘트 자동작성 — edutrix generateDailyNotice의 Solar 이식.
 * eywa 단일 진입점 generateJSON(기본 Solar Pro 3, 직접 provider 호출 금지)로 `{comment}` 생성.
 * DB 미변경(순수 생성) → 로그인만 확인. 실패 시 ok:false → 클라이언트가 결정적 템플릿(buildSubjectReport)으로 폴백.
 */
export async function generateReportComment(
  input: ReportCommentInput,
): Promise<{ ok: boolean; comment?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  try {
    const { data } = await generateJSON<{ comment?: string }>({
      prompt: buildReportCommentPrompt(input),
      maxTokens: 700,
      keyName: "default",
    });
    const comment = (data.comment ?? "").trim();
    if (!comment) return { ok: false, error: "빈 응답" };
    return { ok: true, comment };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI 생성 실패" };
  }
}
