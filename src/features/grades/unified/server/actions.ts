"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { gradeWriteError } from "@/features/grades/server/access";
import { gradeMonthReady, gradeNoExamReady, updateUnifiedGrade, type UnifiedGradePatch } from "@/features/grades/server/write";
import { termWindow, type Term } from "@/features/grades/term";
import { logAction } from "@/features/audit/server/log";
import { addAcademicConsultation } from "./consultation";
import { recordKey } from "./consultation-link";
import { canEditStudent } from "./scope";
import { reportScorePatch } from "../report-patch";

export type UnifiedSaveState = { ok?: boolean; error?: string } | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 각 출처의 원본 행을 수정한다. 외부에서 보낸 학생·반·과목은 신뢰하지 않는다. */
export async function saveUnifiedGrade(_previous: UnifiedSaveState, formData: FormData): Promise<UnifiedSaveState> {
  const gate = await gradeWriteError();
  if (gate) return { error: gate };
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const source = String(formData.get("source") ?? "");
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const date = String(formData.get("date") ?? "");
  const scoreRaw = String(formData.get("score") ?? "").trim();
  const maxRaw = String(formData.get("maxScore") ?? "").trim();
  const consultationDate = String(formData.get("consultationDate") ?? "").trim();
  const originalConsultationDate = String(formData.get("originalConsultationDate") ?? "").trim();
  if (!UUID.test(id) || !validIsoDate(date)) return { error: "시험일을 확인해 주세요" };
  const score = scoreRaw === "" ? null : Number(scoreRaw);
  const maxScore = maxRaw === "" ? null : Number(maxRaw);
  if (score != null && (!Number.isFinite(score) || score < 0)) return { error: "점수는 0 이상이어야 합니다" };
  if (maxScore != null && (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000)) return { error: "만점은 1~1000 사이여야 합니다" };
  if (score != null && (maxScore == null || score > maxScore)) return { error: "점수는 만점을 넘을 수 없습니다" };
  if (consultationDate && !validIsoDate(consultationDate)) return { error: "상담일을 확인해 주세요" };

  const supabase = await createClient();
  let studentId: string;
  let subject: string;
  let consultationRecordKey: string;
  let classId: string | null = null;
  if (source === "grade") {
    const { data, error } = await supabase.from("student_grades")
      .select("id, student_id, subject, school_year, term, exam_slot, score, max_score, taken_on")
      .eq("id", id).eq("tenant_id", user.tenantId).single();
    if (error || !data) return { error: "성적 기록을 찾지 못했습니다" };
    studentId = data.student_id;
    subject = data.subject;
    consultationRecordKey = recordKey("grade", id);
    const year = Number(data.school_year);
    const term = Number(data.term) as Term;
    if ((term === 1 || term === 2) && year >= 2000) {
      const window = termWindow(year, term);
      if (date < window.start || date > window.end) return { error: "시험일은 해당 학기 안이어야 합니다" };
    }
    const access = await canEditStudent(studentId, subject, user.tenantId);
    if (!access) return { error: "이 학생의 성적을 수정할 권한이 없습니다" };
    const sameScore = score === (data.score == null ? null : Number(data.score)) &&
      (score == null || maxScore === (data.max_score == null ? null : Number(data.max_score)));
    if (!sameScore || date !== data.taken_on) {
      const patch: UnifiedGradePatch = { score, max_score: maxScore, taken_on: date };
      if (score != null && await gradeNoExamReady()) { patch.no_exam = false; patch.no_exam_reason = null; }
      if (data.exam_slot === "monthly" && await gradeMonthReady()) patch.exam_month = Number(date.slice(5, 7));
      const saveError = await updateUnifiedGrade(user.tenantId, id, patch);
      if (saveError) return { error: saveError };
    }
  } else if (source === "report") {
    if (kind !== "daily" && kind !== "check" && kind !== "other") return { error: "시험 종류를 확인해 주세요" };
    const { data, error } = await supabase.from("lesson_reports")
      .select("id, student_id, class_id, subject, report_date, daily_test, check_test, exam_info")
      .eq("id", id).eq("tenant_id", user.tenantId).single();
    if (error || !data) return { error: "수업보고서 기록을 찾지 못했습니다" };
    studentId = data.student_id;
    subject = data.subject ?? "";
    consultationRecordKey = recordKey("report", id, kind as "daily" | "check" | "other");
    classId = data.class_id;
    if (!subject && classId) {
      const { data: sourceClass } = await supabase.from("classes").select("subject")
        .eq("id", classId).eq("tenant_id", user.tenantId).single();
      subject = sourceClass?.subject ?? "";
    }
    if (date !== data.report_date) return { error: "일일·확인테스트 날짜는 수업보고서 날짜와 같습니다. 보고서에서 수정해 주세요" };
    if (!(await canEditStudent(studentId, subject, user.tenantId, classId))) return { error: "이 보고서를 수정할 권한이 없습니다" };
    if (kind === "other" && (data.daily_test || data.check_test || !data.exam_info)) return { error: "기존 시험점수 형식을 확인해 주세요" };
    const patch = reportScorePatch(data, kind, score, maxScore);
    if (patch) {
      const { data: saved, error: saveError } = await supabase.from("lesson_reports").update(patch)
        .eq("id", id).eq("tenant_id", user.tenantId).select("id").single();
      if (saveError || !saved) return { error: saveError?.message ?? "테스트 점수를 저장하지 못했습니다" };
    }
  } else if (source === "level") {
    const { data, error } = await supabase.from("level_tests")
      .select("id, student_id, subject, tested_on, subscores")
      .eq("id", id).eq("tenant_id", user.tenantId).single();
    if (error || !data) return { error: "입학테스트 기록을 찾지 못했습니다" };
    studentId = data.student_id;
    subject = data.subject;
    consultationRecordKey = recordKey("level", id);
    if (!(await canEditStudent(studentId, subject, user.tenantId))) return { error: "이 학생의 테스트를 수정할 권한이 없습니다" };
    const subscores = { ...((data.subscores as Record<string, number> | null) ?? {}) };
    const numeric = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const storedScore = numeric(subscores["총점"]);
    const storedMax = numeric(subscores["만점"]);
    const scoreChanged = score !== storedScore || score != null && maxScore !== storedMax;
    if (date !== data.tested_on || scoreChanged) {
      if (scoreChanged) {
        if (score == null) { delete subscores["총점"]; delete subscores["만점"]; }
        else { subscores["총점"] = score; subscores["만점"] = maxScore!; }
      }
      const { data: saved, error: saveError } = await supabase.from("level_tests")
        .update({ tested_on: date, ...(scoreChanged ? { subscores } : {}) })
        .eq("id", id).eq("tenant_id", user.tenantId).select("id").single();
      if (saveError || !saved) return { error: saveError?.message ?? "입학테스트를 저장하지 못했습니다" };
    }
  } else return { error: "알 수 없는 성적 출처입니다" };

  if (consultationDate && consultationDate !== originalConsultationDate) {
    const error = await addAcademicConsultation(user.tenantId, {
      studentId, subject, recordKey: consultationRecordKey, date: consultationDate,
    });
    if (error) return { error: `점수는 저장됐지만 상담일을 저장하지 못했습니다: ${error}` };
  }
  await logAction({ action: "exam_scores", targetType: "grades", targetLabel: `${subject} 성적 · ${date}`,
    metadata: { source, sourceId: id, studentId, subject, date, score, maxScore } });
  revalidatePath("/exams");
  revalidatePath("/exams/input");
  return { ok: true };
}
