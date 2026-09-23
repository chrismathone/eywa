"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { gradeWriteError } from "@/features/grades/server/access";
import { KIND_LABEL, type UnifiedKind } from "../model";
import { testScoresOf } from "@/features/math-sheets/lib/test-score";
import { logAction } from "@/features/audit/server/log";
import { canEditStudent } from "./scope";
import type { UnifiedSaveState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CREATE_KINDS = new Set<UnifiedKind>(["daily", "check", "admission", "other"]);

/** 수업보고서·입학테스트의 기존 점수와 같은 원장에 새 시험 결과를 추가한다. */
export async function createUnifiedGrade(_previous: UnifiedSaveState, formData: FormData): Promise<UnifiedSaveState> {
  const gate = await gradeWriteError();
  if (gate) return { error: gate };
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const studentId = String(formData.get("studentId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const kind = String(formData.get("kind") ?? "") as UnifiedKind;
  const date = String(formData.get("date") ?? "");
  const scoreRaw = String(formData.get("score") ?? "").trim();
  const maxScore = Number(formData.get("maxScore"));
  const score = scoreRaw ? Number(scoreRaw) : null;
  if (!UUID.test(studentId) || !subject || subject.length > 64 || !CREATE_KINDS.has(kind)) return { error: "학생·과목·시험 종류를 확인해 주세요" };
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!ISO_DATE.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return { error: "시험일을 확인해 주세요" };
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000 ||
    (score != null && (!Number.isFinite(score) || score < 0 || score > maxScore))) return { error: "점수와 만점을 확인해 주세요" };
  const supabase = await createClient();
  const { data: student } = await supabase.from("students").select("id")
    .eq("id", studentId).eq("tenant_id", user.tenantId).single();
  if (!student || !(await canEditStudent(studentId, subject, user.tenantId))) return { error: "이 학생의 성적을 입력할 권한이 없습니다" };
  const examName = KIND_LABEL[kind];
  const { data: existing, error: lookupError } = await supabase.from("student_grades")
    .select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId)
    .eq("subject", subject).eq("exam_name", examName).eq("taken_on", date).limit(1);
  if (lookupError) return { error: "기존 기록을 확인하지 못했습니다" };
  if (existing?.length) return { error: "같은 날짜의 시험 기록이 이미 있습니다. 아래 원장에서 수정해 주세요" };
  if (kind === "daily" || kind === "check") {
    const { data: reports, error: reportError } = await supabase.from("lesson_reports")
      .select("daily_test, check_test, exam_info").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).eq("subject", subject).eq("report_date", date).limit(30);
    if (reportError) return { error: "수업보고서 기록을 확인하지 못했습니다" };
    if (reports?.some((report) => testScoresOf({ dailyTest: report.daily_test, checkTest: report.check_test,
      examInfo: report.exam_info }).some((test) => test.kind === kind))) {
      return { error: "같은 날짜의 수업보고서 시험이 있습니다. 아래 원장에서 수정해 주세요" };
    }
  }
  if (kind === "admission") {
    const { data: levels, error: levelError } = await supabase.from("level_tests")
      .select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId)
      .eq("subject", subject).eq("test_type", "placement").eq("tested_on", date).limit(1);
    if (levelError) return { error: "입학테스트 기록을 확인하지 못했습니다" };
    if (levels?.length) return { error: "같은 날짜의 입학테스트가 있습니다. 아래 원장에서 수정해 주세요" };
  }
  const { error } = await supabase.from("student_grades").insert({
    tenant_id: user.tenantId, student_id: studentId, subject, exam_name: examName,
    taken_on: date, score, max_score: maxScore, created_by: user.id,
  });
  if (error) return { error: error.message };
  await logAction({ action: "exam_scores", targetType: "grades", targetLabel: `${examName} · ${date}`,
    metadata: { studentId, subject, date, score, maxScore, kind, created: true } });
  revalidatePath("/exams");
  return { ok: true };
}
