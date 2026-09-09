import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
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
// export: 일일 브리핑 cron이 캐시 없이 직접 호출한다(새벽 1회라 unstable_cache 불필요, 세션 없음).
export async function computeRetentionRoster(tenantId: string, teacherId?: string): Promise<RosterStudent[]> {
  const admin = createAdminClient();

  const { data: students } = await admin
    .from("students")
    .select(`id, name, grade, school, notes, ai_care_summary`)
    .eq("tenant_id", tenantId)
    .eq("status", "enrolled");
  if (!students || students.length === 0) return [];

  const ids = students.map((s) => s.id);
  // 창의 기준은 **KST 오늘** — `toIsoDate`가 이제 KST 날짜를 준다(roster.ts 주석).
  const today = new Date();
  const since = (days: number) => toIsoDate(addDays(today, -days));

  // 각 테이블을 student_id 청크로 병렬 조회(414·1000행 한도 회피, error throw). admin client라 RLS가
  // 없으므로 모든 쿼리에 .eq(tenant_id)를 직접 건다(방어적 — student_id는 이미 이 테넌트 학생이지만).
  const [attendance, reportHomework, grades, consultations, invoices, enrollments] = await Promise.all([
    fetchByStudentChunks(ids, (c) =>
      admin
        .from("attendance_records")
        .select("student_id, status, session_date, homework_required, homework_done")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("session_date", since(ATTEND_WINDOW_DAYS)),
    ),
    // 숙제 이행률의 1순위 소스(출석부 체크박스는 실사용 0건 — roster/homework-score.ts 주석).
    // 재원생 전원 × 30일이면 청크당 1,000행을 넘길 수 있어(실측 30일 1,900+건) 반드시 페이지네이션(B2).
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("lesson_reports")
        .select("student_id, report_date, homework_score")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("report_date", since(ATTEND_WINDOW_DAYS))
        .not("homework_score", "is", null)
        .order("report_date", { ascending: false })
        .order("id", { ascending: true }) // OFFSET 페이지가 흔들리지 않도록 unique tie-break
        .range(from, to),
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
        .select("student_id, end_date, on_hold, class:class_id ( teacher_id, teacher:teacher_id ( display_name ) )")
        .eq("tenant_id", tenantId)
        .in("student_id", c),
    ),
  ]);

  // 과목별 담당 강사(단일 담임 대체) — 활성 수강(end_date null) 반의 teacher_id/이름 집계.
  const teacherNamesByStudent = new Map<string, Set<string>>();
  const teacherIdsByStudent = new Map<string, Set<string>>();
  for (const e of enrollments as {
    student_id: string;
    end_date: string | null;
    class?: { teacher_id?: string | null; teacher?: { display_name?: string } | { display_name?: string }[] | null } | { teacher_id?: string | null; teacher?: unknown }[] | null;
  }[]) {
    if (e.end_date) continue;
    const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { teacher_id?: string | null; teacher?: { display_name?: string } | { display_name?: string }[] | null }
      | undefined;
    if (!cls?.teacher_id) continue;
    (teacherIdsByStudent.get(e.student_id) ?? teacherIdsByStudent.set(e.student_id, new Set()).get(e.student_id)!).add(cls.teacher_id);
    const t = (Array.isArray(cls.teacher) ? cls.teacher[0] : cls.teacher) as { display_name?: string } | undefined;
    if (t?.display_name) {
      (teacherNamesByStudent.get(e.student_id) ?? teacherNamesByStudent.set(e.student_id, new Set()).get(e.student_id)!).add(t.display_name);
    }
  }

  // 담당 강사 필터 → 그 강사 반에 수강 중인 학생만.
  const scopedStudents = teacherId
    ? students.filter((s) => teacherIdsByStudent.get(s.id)?.has(teacherId))
    : students;

  const raw: RetentionRawData = {
    students: scopedStudents.map((s) => ({
      ...s,
      teacherNames: [...(teacherNamesByStudent.get(s.id) ?? [])].sort(),
    })) as RetentionRawData["students"],
    attendance: attendance as RetentionRawData["attendance"],
    reportHomework: reportHomework as RetentionRawData["reportHomework"],
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
