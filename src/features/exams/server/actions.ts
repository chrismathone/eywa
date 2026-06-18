"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevel } from "@/lib/permissions";
import type { SystemRole } from "@/lib/permissions";

export type ExamActionState = { error?: string; ok?: boolean } | undefined;

const EXAM_TYPES = ["weekly", "mock", "school"] as const;

function canWrite(role: SystemRole): boolean {
  const lvl = accessLevel(role, "exams");
  return lvl === "full" || lvl === "scoped"; // readonly/none은 쓰기 불가
}

type ExamFields = {
  name: string;
  subject: string;
  examType: string;
  examDate: string;
  maxScore: string | null;
  notes: string | null;
  error?: string;
};

function readExamForm(formData: FormData): ExamFields {
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const examTypeRaw = String(formData.get("examType") ?? "weekly").trim();
  const examType = (EXAM_TYPES as readonly string[]).includes(examTypeRaw) ? examTypeRaw : "weekly";
  const examDate = String(formData.get("examDate") ?? "").trim();
  const maxScore = String(formData.get("maxScore") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  let error: string | undefined;
  if (!name) error = "시험명을 입력해주세요";
  else if (!subject) error = "과목을 선택해주세요";
  else if (!examDate) error = "시험일을 입력해주세요";

  return { name, subject, examType, examDate, maxScore, notes, error };
}

export async function createExam(_prev: ExamActionState, formData: FormData): Promise<ExamActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canWrite(user.systemRole)) return { error: "시험 관리 권한이 없습니다" };

  const f = readExamForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase.from("exams").insert({
    tenant_id: user.tenantId,
    name: f.name,
    subject: f.subject,
    exam_type: f.examType,
    exam_date: f.examDate,
    max_score: f.maxScore,
    notes: f.notes,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/exams");
  return { ok: true };
}

export async function updateExam(_prev: ExamActionState, formData: FormData): Promise<ExamActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canWrite(user.systemRole)) return { error: "시험 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "시험 ID가 누락되었습니다" };
  const f = readExamForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exams")
    .update({
      name: f.name,
      subject: f.subject,
      exam_type: f.examType,
      exam_date: f.examDate,
      max_score: f.maxScore,
      notes: f.notes,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/exams");
  revalidatePath(`/exams/${id}`);
  return { ok: true };
}

export async function deleteExam(_prev: ExamActionState, formData: FormData): Promise<ExamActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canWrite(user.systemRole)) return { error: "시험 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "시험 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 연결된 점수(student_grades.exam_id)는 FK on delete cascade로 함께 삭제.
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/exams");
  return { ok: true };
}

type ScoreEntry = { studentId: string; score: number | null };

function parseEntries(raw: string): ScoreEntry[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: ScoreEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const studentId = String(o.studentId ?? "").trim();
      if (!studentId) return null;
      const rawScore = o.score;
      const score =
        rawScore == null || rawScore === ""
          ? null
          : Number.isFinite(Number(rawScore))
            ? Number(rawScore)
            : null;
      out.push({ studentId, score });
    }
    return out;
  } catch {
    return null;
  }
}

/** 한 시험에 대해 제출된 학생들의 점수를 일괄 저장(제출분만 delete→insert, index-agnostic 멱등). */
export async function batchSaveScores(
  _prev: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canWrite(user.systemRole)) return { error: "시험 관리 권한이 없습니다" };

  const examId = String(formData.get("examId") ?? "").trim();
  if (!examId) return { error: "시험 ID가 누락되었습니다" };
  const entries = parseEntries(String(formData.get("entries") ?? ""));
  if (!entries) return { error: "점수 데이터 형식이 올바르지 않습니다" };
  if (entries.length === 0) return { ok: true };

  const supabase = await createClient();
  const { data: exam } = await supabase
    .from("exams")
    .select("name, subject, exam_date, max_score")
    .eq("id", examId)
    .single();
  if (!exam) return { error: "시험을 찾을 수 없습니다" };

  const studentIds = entries.map((e) => e.studentId);
  // 제출된 학생의 기존 점수만 비우고(다른 반/미제출 학생 점수는 보존) 새로 입력.
  const { error: delErr } = await supabase
    .from("student_grades")
    .delete()
    .eq("exam_id", examId)
    .in("student_id", studentIds);
  if (delErr) return { error: delErr.message };

  const rows = entries
    .filter((e) => e.score != null)
    .map((e) => ({
      tenant_id: user.tenantId,
      student_id: e.studentId,
      exam_id: examId,
      exam_name: exam.name,
      subject: exam.subject,
      score: e.score,
      max_score: exam.max_score,
      taken_on: exam.exam_date,
      created_by: user.id,
    }));

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("student_grades").insert(rows);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/exams");
  revalidatePath(`/exams/${examId}`);
  for (const id of studentIds) revalidatePath(`/students/${id}`);
  return { ok: true };
}
