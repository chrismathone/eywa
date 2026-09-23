"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { saveGradeScores, type GradeSaveState } from "@/features/grades/server/actions";
import { addAcademicConsultation } from "./consultation";
import { saveUnifiedGrade } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 새 원장의 명단 행도 기존 성적 저장 경로로 보내 날짜·시험 축과 권한 판정을 공유한다. */
export async function saveUnifiedRosterGrade(previous: GradeSaveState, formData: FormData): Promise<GradeSaveState> {
  const existingId = String(formData.get("scoreId") ?? "");
  if (UUID.test(existingId)) {
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
  const consultationDate = String(formData.get("consultationDate") ?? "");
  const original = String(formData.get("originalConsultationDate") ?? "");
  if (!consultationDate || consultationDate === original) return result;
  if (!ISO_DATE.test(consultationDate)) return { error: "상담일을 확인해 주세요" };
  const entries = String(formData.get("entries") ?? "");
  let studentId: string;
  try { studentId = (JSON.parse(entries) as { studentId: string }[])[0]?.studentId ?? ""; }
  catch { return { error: "학생을 확인해 주세요" }; }
  if (!UUID.test(studentId)) return { error: "학생을 확인해 주세요" };
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const subject = String(formData.get("subject") ?? "");
  const error = await addAcademicConsultation(user.tenantId, studentId, subject, consultationDate);
  if (error) return { error: `점수는 저장됐지만 상담일을 저장하지 못했습니다: ${error}` };
  revalidatePath("/exams");
  return result;
}
