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

// 학생 id를 단일 .in()에 전부 넣으면 재원생 수백 명일 때 GET URL이 HTTP 414로 실패하고,
// 그 error를 (data ?? [])로 삼키면 출결/성적/상담/수납/수강이 통째로 비어 위험점수가 거짓이 된다
// (admin findOrphans와 동일 뿌리). id를 100개씩 청크로 나눠 병렬 조회 → URL 길이 안전 +
// 청크당 행 수가 PostgREST 기본 1000행 한도 아래로 유지된다. error는 절대 삼키지 않고 throw.
const ID_CHUNK = 100;
function chunkIds(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
  return out;
}
async function fetchByStudentChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const results = await Promise.all(chunkIds(ids).map((c) => run(c)));
  const out: T[] = [];
  for (const r of results) {
    if (r.error) throw new Error(`retention roster query failed: ${r.error.message}`);
    if (r.data) out.push(...r.data);
  }
  return out;
}

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
  const since = (days: number) => toIsoDate(addDays(today, -days));

  // 각 테이블을 student_id 청크로 병렬 조회(414·1000행 한도 회피, error throw). 한 학생의 행은
  // 모두 같은 청크에 모이므로 .order(per-student 최신순)가 청크 내에서 보존된다.
  const [attendance, grades, consultations, invoices, enrollments] = await Promise.all([
    fetchByStudentChunks(ids, (c) =>
      supabase
        .from("attendance_records")
        .select("student_id, status, session_date, homework_required, homework_done")
        .in("student_id", c)
        .gte("session_date", since(ATTEND_WINDOW_DAYS)),
    ),
    fetchByStudentChunks(ids, (c) =>
      supabase
        .from("student_grades")
        .select("student_id, score, max_score, taken_on")
        .in("student_id", c)
        .gte("taken_on", since(GRADE_WINDOW_DAYS))
        .order("taken_on", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      supabase
        .from("student_consultations")
        .select("student_id, consulted_at, summary, follow_up_date, follow_up_done")
        .in("student_id", c)
        .gte("consulted_at", since(CONSULT_WINDOW_DAYS))
        .order("consulted_at", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      supabase
        .from("invoices")
        .select("student_id, amount_total, period")
        .in("student_id", c)
        .order("period", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      supabase.from("enrollments").select("student_id, end_date, on_hold").in("student_id", c),
    ),
  ]);

  const raw: RetentionRawData = {
    students: students as RetentionRawData["students"],
    attendance: attendance as RetentionRawData["attendance"],
    grades: grades as RetentionRawData["grades"],
    consultations: consultations as RetentionRawData["consultations"],
    invoices: invoices as RetentionRawData["invoices"],
    enrollments: enrollments as RetentionRawData["enrollments"],
  };
  return buildRoster(raw, today);
}

/** 학부모 메시지 서명용 학원명(RLS가 본인 테넌트로 스코프). */
export async function getTenantName(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("name").limit(1).maybeSingle();
  return data?.name ?? "우리 학원";
}
