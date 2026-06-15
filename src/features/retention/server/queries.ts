import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  buildRoster,
  toIsoDate,
  addDays,
  type RetentionRawData,
  type RosterStudent,
} from "../roster";

// 집계 로직·타입은 roster.ts(순수)에 있다. 페이지가 기존처럼 여기서 import하도록 재노출.
export { summarizeRoster } from "../roster";
export type { RosterStudent, RetentionStats } from "../roster";

const ATTEND_WINDOW_DAYS = 30;
const GRADE_WINDOW_DAYS = 180;
const CONSULT_WINDOW_DAYS = 180;

/**
 * 재원생 전원의 이탈 위험 명단. eywa 실데이터를 배치 조회 → buildRoster로 점수화.
 * RLS가 테넌트 격리를 강제하고, teacherId가 주어지면 담당 학생만(강사 scoped).
 */
export async function getRetentionRoster(opts?: { teacherId?: string }): Promise<RosterStudent[]> {
  const supabase = await createClient();

  let studentQuery = supabase
    .from("students")
    .select(
      `id, name, grade, school, notes, ai_care_summary, primary_teacher_id,
       teacher:primary_teacher_id ( display_name )`,
    )
    .eq("status", "enrolled");
  if (opts?.teacherId) studentQuery = studentQuery.eq("primary_teacher_id", opts.teacherId);
  const { data: students } = await studentQuery;
  if (!students || students.length === 0) return [];

  const ids = students.map((s) => s.id);
  const today = new Date();

  const [attRes, gradeRes, consultRes, invoiceRes, enrollRes] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("student_id, status, session_date, homework_required, homework_done")
      .in("student_id", ids)
      .gte("session_date", toIsoDate(addDays(today, -ATTEND_WINDOW_DAYS))),
    supabase
      .from("student_grades")
      .select("student_id, score, max_score, taken_on")
      .in("student_id", ids)
      .gte("taken_on", toIsoDate(addDays(today, -GRADE_WINDOW_DAYS)))
      .order("taken_on", { ascending: false }),
    supabase
      .from("student_consultations")
      .select("student_id, consulted_at, summary, follow_up_date, follow_up_done")
      .in("student_id", ids)
      .gte("consulted_at", toIsoDate(addDays(today, -CONSULT_WINDOW_DAYS)))
      .order("consulted_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("student_id, amount_total, period")
      .in("student_id", ids)
      .order("period", { ascending: false }),
    supabase.from("enrollments").select("student_id, end_date, on_hold").in("student_id", ids),
  ]);

  const raw: RetentionRawData = {
    students: students as RetentionRawData["students"],
    attendance: (attRes.data ?? []) as RetentionRawData["attendance"],
    grades: (gradeRes.data ?? []) as RetentionRawData["grades"],
    consultations: (consultRes.data ?? []) as RetentionRawData["consultations"],
    invoices: (invoiceRes.data ?? []) as RetentionRawData["invoices"],
    enrollments: (enrollRes.data ?? []) as RetentionRawData["enrollments"],
  };
  return buildRoster(raw, today);
}

/** 학부모 메시지 서명용 학원명(RLS가 본인 테넌트로 스코프). */
export async function getTenantName(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("name").limit(1).maybeSingle();
  return data?.name ?? "우리 학원";
}
