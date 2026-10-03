import "server-only";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { retentionNotStartedStudentIds } from "../not-started";
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

// 학생 id를 단일 .in()에 전부 넣으면 재원생 수백 명일 때 GET URL이 HTTP 414로 실패하고(#53),
// 청크(100명)로 나눠도 **청크 안에서** 1000행에 잘린다(#54) — 영어 출결은 교시마다 한 행이라 100명 × 30일이면
// 쉽게 넘고, 잘린 만큼 결석이 적게 세어져 위험 학생이 '살펴볼 학생'에서 빠졌다(감사 T1, 2026-09-23).
// 그래서 모든 표를 청크 × 페이징(fetchAllPagedInChunks, .order("id") tie-break)으로 받는다. error는 throw.

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

  // 🔴 조회 실패를 빈 배열로 삼키면 '위험 0명'이 사실처럼 보인다(감사 T1) — 던진다.
  const students = await fetchAllPaged<{
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
    notes: string | null;
    ai_care_summary: string | null;
  }>((from, to) =>
    admin
      .from("students")
      .select(`id, name, grade, school, notes, ai_care_summary`)
      .eq("tenant_id", tenantId)
      .eq("status", "enrolled")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (students.length === 0) return [];

  const ids = students.map((s) => s.id);
  // 창의 기준은 **KST 오늘** — `toIsoDate`가 이제 KST 날짜를 준다(roster.ts 주석).
  const today = new Date();
  const since = (days: number) => toIsoDate(addDays(today, -days));

  // 각 테이블을 student_id 청크로 병렬 조회(414·1000행 한도 회피, error throw). admin client라 RLS가
  // 없으므로 모든 쿼리에 .eq(tenant_id)를 직접 건다(방어적 — student_id는 이미 이 테넌트 학생이지만).
  const [rawAttendance, reportHomework, grades, consultations, invoices, enrollments] = await Promise.all([
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("attendance_records")
        .select("id, student_id, class_id, slot_start, recorded_at, status, session_date, homework_required, homework_done")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("session_date", since(ATTEND_WINDOW_DAYS))
        .order("id", { ascending: true })
        .range(from, to),
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
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("student_grades")
        .select("student_id, score, max_score, taken_on")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("taken_on", since(GRADE_WINDOW_DAYS))
        .order("taken_on", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("student_consultations")
        .select("student_id, consulted_at, summary, follow_up_date, follow_up_done")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .gte("consulted_at", since(CONSULT_WINDOW_DAYS))
        .order("consulted_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("invoices")
        .select("student_id, amount_total, period")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .neq("status", "void") // void = makeedu에서 삭제된 청구 — 리스크 신호에서 제외
        .order("period", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedInChunks(ids, (c, from, to) =>
      admin
        .from("enrollments")
        // `start_date` — '실시간 재원생' 판정 재료(아래 notStarted). 🔴 조회에서 시작일로 거르지 않는다:
        //   아직 안 시작한 수강만 가진 학생이 누구인지 알려면 그 줄도 받아야 한다(원생목록과 같은 규칙).
        .select("student_id, start_date, end_date, on_hold, class:class_id ( teacher_id, teacher:teacher_id ( display_name ) )")
        .eq("tenant_id", tenantId)
        .in("student_id", c)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);  // 🔴 정정 줄은 최신 하나만 — 고친 결석을 결석으로 세어 위험 점수가 오르던 것(점검 2026-09-28).
  const attendance = effectiveAttendanceRecords(rawAttendance);


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

  /**
   * 🔴 **재원생 = '실시간'**(원장 2026-09-16 — docs/decisions/students.md): 아직 한 과목도 시작 안 한 학생은 명단에서 뺀다.
   *    원생목록·운영실·슈퍼관리자 화면은 이미 그렇게 세는데 리텐션만 상태가 재원인 학생 전원이라 "재원생 335명"과
   *    원생목록 "334명"이 갈렸다(운영점검 2026-10-03 A02). 판정은 새로 짓지 않고 원생목록과 **같은 함수**
   *    (`notYetStartedStudentIds`)·같은 재료 조건(종료 안 됨 · 휴원 아님)·같은 기준일(KST 오늘)을 쓴다.
   *    화면의 숫자("재원생 N명")는 이 명단의 길이라 숫자와 목록이 같은 집합이다 — 브리핑 cron도 이 함수를 그대로 탄다.
   * ⚠️ 수강이 아예 없는 재원생·시작일을 모르는 수강은 남는다(모름을 '미시작'으로 읽지 않는다).
   */
  const notStarted = retentionNotStartedStudentIds(
    enrollments as { student_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null }[],
    kstToday(),
  );
  const startedStudents = notStarted.size > 0 ? students.filter((s) => !notStarted.has(s.id)) : students;

  // 담당 강사 필터 → 그 강사 반에 수강 중인 학생만.
  const scopedStudents = teacherId
    ? startedStudents.filter((s) => teacherIdsByStudent.get(s.id)?.has(teacherId))
    : startedStudents;

  const raw: RetentionRawData = {
    students: scopedStudents.map((s) => ({
      ...s,
      teacherNames: [...(teacherNamesByStudent.get(s.id) ?? [])].sort(),
    })) as RetentionRawData["students"],
    attendance: attendance as RetentionRawData["attendance"],
    reportHomework: reportHomework as RetentionRawData["reportHomework"],
    grades: grades as RetentionRawData["grades"],
    consultations: (consultations as RetentionRawData["consultations"]).map((row) => ({
      ...row, summary: row.summary ? visibleConsultationSummary(row.summary) : row.summary,
    })),
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
