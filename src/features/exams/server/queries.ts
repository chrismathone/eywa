import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getClassesList, getClassStudents } from "@/features/classes/server/queries";
import { examStats, rankByScore, type ExamStats } from "../calc";

export type ExamScope = {
  type: "class" | "grade" | "academy";
  classIds?: string[];
  grades?: string[];
} | null;

export type ExamRow = {
  id: string;
  name: string;
  subject: string;
  examType: string; // weekly/mock/school
  examDate: string;
  maxScore: number | null;
  scope: ExamScope;
  stats: ExamStats;
};

export type ExamFilters = { subject?: string; from?: string; to?: string };

const PAGE_SIZE = 50;

const num = (v: string | number | null): number | null => (v == null ? null : Number(v));

/** 시험 목록(페이지) + 페이지 행들의 통계 on-the-fly. denormalize 안 함(단일성적 편집과 드리프트 없음). */
export async function getExamsPage(
  filters: ExamFilters = {},
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<{ rows: ExamRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("exams")
    .select("id, name, subject, exam_type, exam_date, max_score, scope", { count: "exact" })
    .order("exam_date", { ascending: false })
    .range(from, from + pageSize - 1);
  if (filters.subject) q = q.eq("subject", filters.subject);
  if (filters.from) q = q.gte("exam_date", filters.from);
  if (filters.to) q = q.lte("exam_date", filters.to);

  const { data, count, error } = await q;
  if (error) throw new Error(`getExamsPage: ${error.message}`);
  const exams = data ?? [];
  if (exams.length === 0) return { rows: [], total: count ?? 0 };

  const examIds = exams.map((e) => e.id);
  const scores = await fetchInChunks<{ exam_id: string; score: string | null; max_score: string | null }>(
    examIds,
    (chunk) => supabase.from("student_grades").select("exam_id, score, max_score").in("exam_id", chunk),
  );
  const byExam = new Map<string, { score: number | null; maxScore: number | null }[]>();
  for (const s of scores) {
    const arr = byExam.get(s.exam_id) ?? [];
    arr.push({ score: num(s.score), maxScore: num(s.max_score) });
    byExam.set(s.exam_id, arr);
  }

  const rows: ExamRow[] = exams.map((e) => ({
    id: e.id,
    name: e.name,
    subject: e.subject,
    examType: e.exam_type,
    examDate: e.exam_date,
    maxScore: num(e.max_score),
    scope: (e.scope ?? null) as ExamScope,
    stats: examStats(byExam.get(e.id) ?? []),
  }));
  return { rows, total: count ?? 0 };
}

export type ExamDetail = ExamRow & { notes: string | null };

export async function getExamDetail(id: string): Promise<ExamDetail | null> {
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("exams")
    .select("id, name, subject, exam_type, exam_date, max_score, scope, notes")
    .eq("id", id)
    .single();
  if (!e) return null;

  const { data: scores } = await supabase
    .from("student_grades")
    .select("score, max_score")
    .eq("exam_id", id);
  const stats = examStats((scores ?? []).map((s) => ({ score: num(s.score), maxScore: num(s.max_score) })));

  return {
    id: e.id,
    name: e.name,
    subject: e.subject,
    examType: e.exam_type,
    examDate: e.exam_date,
    maxScore: num(e.max_score),
    scope: (e.scope ?? null) as ExamScope,
    notes: e.notes,
    stats,
  };
}

export type ExamScoreRow = {
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  score: number | null;
  rank: number | null;
};

/** 시험 일괄입력 그리드: 반 재원학생 + 이 시험의 기존 점수 머지 + 석차. */
export async function getExamScoreRows(examId: string, classId: string): Promise<ExamScoreRow[]> {
  const supabase = await createClient();
  const students = await getClassStudents(classId);
  if (students.length === 0) return [];

  const studentIds = students.map((s) => s.studentId);
  const existing = await fetchInChunks<{ student_id: string; score: string | null }>(
    studentIds,
    (chunk) =>
      supabase.from("student_grades").select("student_id, score").eq("exam_id", examId).in("student_id", chunk),
  );
  const scoreByStudent = new Map(existing.map((r) => [r.student_id, num(r.score)]));

  const base = students.map((s) => ({
    studentId: s.studentId,
    name: s.name,
    grade: s.grade,
    school: s.school,
    score: scoreByStudent.get(s.studentId) ?? null,
  }));
  return rankByScore(base);
}

/** 시험 상세에서 반 선택용 — 시험 과목과 일치하는 반(scope.classIds 우선). */
export async function getExamClassOptions(
  subject: string,
  scope: ExamScope,
): Promise<{ id: string; className: string; subject: string; studentCount: number }[]> {
  const all = await getClassesList({ subject, active: "active" });
  const scoped =
    scope?.type === "class" && scope.classIds?.length
      ? all.filter((c) => scope.classIds!.includes(c.id))
      : all;
  return scoped.map((c) => ({
    id: c.id,
    className: c.className,
    subject: c.subject,
    studentCount: c.studentCount,
  }));
}
