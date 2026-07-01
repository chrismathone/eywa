"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";

export type SaveLessonReportInput = {
  studentId: string;
  progress: string; // "영어 Unit 8 · p.90"
  examInfo: string; // "일일 18/20, 확인 19/20"
  homeworkScore: string; // 과제 상태
  notes: string; // 학부모 보고서 본문
};

/**
 * 선생님 원스크린 — 수업 보고서를 lesson_reports(0049a)에 저장.
 * D3: 저장만(메시징/PDF 발송 연동은 후속 웨이브). RLS가 tenant 격리 + 앱단에서 강사 스코프 이중 방어
 * (보고서를 쓰려는 학생이 그 강사 담당 반의 활성 수강생이 아니면 거부 — 다른 반 학생에 임의 기록 차단).
 */
export async function saveLessonReport(
  input: SaveLessonReportInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
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

  const now = new Date();
  const reportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  // .select("id").single() → 삽입한 행 id 반환(PDF 인쇄 창이 이 id로 보고서 문서를 연다).
  const { data, error } = await supabase
    .from("lesson_reports")
    .insert({
      tenant_id: user.tenantId,
      student_id: input.studentId,
      report_date: reportDate,
      progress: input.progress || null,
      exam_info: input.examInfo || null,
      homework_score: input.homeworkScore || null,
      teacher_name: user.displayName ?? null,
      notes: input.notes || null,
      source: "onescreen",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };
  return { ok: true, id: data.id };
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
