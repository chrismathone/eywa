import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
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
 * 재원생 전원의 이탈 위험 명단 점수화 — 앱에서 가장 무거운 읽기(6개 테이블 × 청크).
 *
 * 요청 간 캐시(#P3/P4). unstable_cache는 cookie 기반 createClient를 못 쓰므로(cache 컨텍스트에 쿠키
 * 없음) **admin client + 모든 쿼리에 명시적 `.eq(tenant_id)`** 로 테넌트를 직접 스코프하고(RLS 대체),
 * 캐시 키에 tenantId·teacherId를 넣어 교차테넌트/교차스코프 누수를 원천 차단한다.
 */
async function computeRetentionRoster(tenantId: string, teacherId?: string): Promise<RosterStudent[]> {
  const admin = createAdminClient();

  let studentQuery = admin
    .from("students")
    .select(
      `id, name, grade, school, notes, ai_care_summary, primary_teacher_id,
       teacher:primary_teacher_id ( display_name )`,
    )
    .eq("tenant_id", tenantId)
    .eq("status", "enrolled");
  if (teacherId) studentQuery = studentQuery.eq("primary_teacher_id", teacherId);
  const { data: students } = await studentQuery;
  if (!students || students.length === 0) return [];

  const ids = students.map((s) => s.id);
  const today = new Date();
  const since = (days: number) => toIsoDate(addDays(today, -days));

  // 각 테이블을 student_id 청크로 병렬 조회(414·1000행 한도 회피, error throw). admin client라 RLS가
  // 없으므로 모든 쿼리에 .eq(tenant_id)를 직접 건다(방어적 — student_id는 이미 이 테넌트 학생이지만).
  const [attendance, grades, consultations, invoices, enrollments] = await Promise.all([
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("attendance_records")
        .select("student_id, status, session_date, homework_required, homework_done")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("session_date", since(ATTEND_WINDOW_DAYS)),
    ),
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("student_grades")
        .select("student_id, score, max_score, taken_on")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("taken_on", since(GRADE_WINDOW_DAYS))
        .order("taken_on", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("student_consultations")
        .select("student_id, consulted_at, summary, follow_up_date, follow_up_done")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("consulted_at", since(CONSULT_WINDOW_DAYS))
        .order("consulted_at", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("invoices")
        .select("student_id, amount_total, period")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .neq("status", "void") // void = makeedu에서 삭제된 청구 — 리스크 신호에서 제외
        .order("period", { ascending: false }),
    ),
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("enrollments")
        .select("student_id, end_date, on_hold")
        .eq("tenant_id", tenantId)
        .in("student_id", c),
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

/**
 * 위 계산을 tenant·teacher 키로 캐시 — 시간 기반 revalidate 300s(5분). 출결/성적/상담 등 어느 소스가
 * 바뀌어도 5분 내 반영. 캐시 키에 tenantId·teacherId가 들어가 교차 누수 없음.
 */
export async function getRetentionRoster(opts?: { teacherId?: string }): Promise<RosterStudent[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const teacherId = opts?.teacherId;
  const cached = unstable_cache(
    () => computeRetentionRoster(user.tenantId, teacherId),
    ["retention-roster", user.tenantId, teacherId ?? "all"],
    { revalidate: 300 },
  );
  return cached();
}

/** 학부모 메시지 서명용 학원명 — owner 설정(profile.name) 우선, 미설정 시 테넌트명/폴백. */
export async function getTenantName(): Promise<string> {
  const { profile } = await getTenantSettings();
  return profile.name || "우리 학원";
}
