"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { saveGradeScores, type GradeSaveState } from "@/features/grades/server/actions";
import { addAcademicConsultation } from "./consultation";
import { recordKey } from "./consultation-link";
import { saveUnifiedGrade } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./uuid";
import { logDbError } from "@/lib/supabase/db-error";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 새 원장의 명단 행도 기존 성적 저장 경로로 보내 날짜·시험 축과 권한 판정을 공유한다. */
export async function saveUnifiedRosterGrade(previous: GradeSaveState, formData: FormData): Promise<GradeSaveState> {
  const consultationDate = String(formData.get("consultationDate") ?? "").trim();
  const original = String(formData.get("originalConsultationDate") ?? "").trim();
  if (consultationDate && consultationDate !== original && !validIsoDate(consultationDate)) {
    return { error: "상담일을 확인해 주세요" };
  }
  const existingId = String(formData.get("scoreId") ?? "");
  if (isUuid(existingId)) {
    let score: number | null;
    try { score = (JSON.parse(String(formData.get("entries") ?? "")) as { score: number | null }[])[0]?.score ?? null; }
    catch { return { error: "점수를 읽지 못했습니다" }; }
    const update = new FormData();
    update.set("source", "grade"); update.set("id", existingId);
    update.set("date", String(formData.get("date") ?? ""));
    update.set("score", score == null ? "" : String(score));
    update.set("maxScore", String(formData.get("max") ?? ""));
    update.set("kind", String(formData.get("slot") ?? "") === "monthly" ? "monthly" : "school");
    update.set("consultationDate", String(formData.get("consultationDate") ?? ""));
    update.set("originalConsultationDate", String(formData.get("originalConsultationDate") ?? ""));
    return saveUnifiedGrade(undefined, update);
  }
  const result = await saveGradeScores(previous, formData);
  if (!result?.ok) return result;
  if (!consultationDate || consultationDate === original) return result;
  const entries = String(formData.get("entries") ?? "");
  let studentId: string;
  try { studentId = (JSON.parse(entries) as { studentId: string }[])[0]?.studentId ?? ""; }
  catch { return { error: "학생을 확인해 주세요" }; }
  if (!isUuid(studentId)) return { error: "학생을 확인해 주세요" };
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data: grades, error: lookupError } = await supabase.from("student_grades")
    .select("id, subject").eq("tenant_id", user.tenantId).eq("student_id", studentId)
    .eq("subject", String(formData.get("subject") ?? ""))
    .eq("school_year", Number(formData.get("year"))).eq("term", Number(formData.get("term")))
    .eq("exam_slot", String(formData.get("slot") ?? ""))
    .eq("taken_on", String(formData.get("date") ?? "")).limit(2);
  if (lookupError || grades?.length !== 1) {
    logDbError(lookupError, "grades.unified.saveUnifiedRosterGrade");
    return { error: "점수는 저장됐지만 상담을 연결할 시험 기록을 찾지 못했습니다" };
  }
  const error = await addAcademicConsultation(user.tenantId, {
    studentId, subject: grades[0].subject, recordKey: recordKey("grade", grades[0].id), date: consultationDate,
  });
  if (error) return { error: `점수는 저장됐지만 상담일을 저장하지 못했습니다 — ${error}` };
  revalidatePath("/exams");
  return result;
}
