import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import {
  PROGRESS_PAGE_SIZE,
  type ProgressRow,
  type RosterStudent,
} from "./contract";

/**
 * 오늘의수학 연계 — **DB 를 만지는 쪽**. 순수 로직은 contract.ts 에 있다.
 *
 * 🔴 여기의 모든 질의는 admin(service-role) 클라이언트로 돈다 — RLS 를 우회한다.
 *    그래서 **`.from()` 마다 반드시 `.eq("tenant_id", …)`** 를 걸고, `!inner`
 *    임베드마다 임베드 쪽 tenant_id 도 건다. 한 곳만 새도 다른 학원의 학생·진도가
 *    이 API 로 나간다. `tenant-guard.test.ts` 가 소스에서 그 수를 센다.
 *
 * 임베드는 FK 를 컬럼으로 명시한다(`class:class_id!inner`) — 힌트 없는 임베드는
 * 남이 FK 를 하나 더한 날 화면째 죽는다([[#94]] 선례).
 */

/** PostgREST 임베드는 타입상 객체|배열|null 로 온다 — 첫 값으로 편다(선례 동형). */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface EnrollmentRow {
  student_id: string;
  start_date: string | null;
  class:
    | { id?: string; class_name?: string }
    | { id?: string; class_name?: string }[]
    | null;
}

interface StudentRow {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
}

/**
 * 활성 수학반에 재원 중인 학생 전부.
 *
 * 학년 필터는 **일부러 없다** — 관은 전 학년을 나르고, 거르는 곳은 오늘의수학
 * 출제 쪽이다(문항 수 게이트). 여기서 거르면 초등 문항이 채워졌을 때 이 라우트를
 * 또 고쳐야 한다. 테스트 전용 학생(`is_test`, 실측 7명)은 뺀다.
 */
export async function fetchRoster(
  admin: SupabaseClient,
  tenantId: string,
): Promise<RosterStudent[]> {
  // ① 활성 수학반의 유효 수강 — 전건은 B2(1000행 silent 절단) 위험이라 페이징.
  const enrollments = await fetchAllPaged<EnrollmentRow>((from, to) =>
    admin
      .from("enrollments")
      .select(
        "student_id, start_date, class:class_id!inner(id, class_name, subject, is_active, closed_at, tenant_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("class.tenant_id", tenantId)
      .eq("class.subject", "math")
      .eq("class.is_active", true)
      .is("class.closed_at", null)
      .is("end_date", null)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const byStudent = new Map<string, Array<{ id: string; name: string; startDate: string | null }>>();
  for (const row of enrollments) {
    const cls = one(row.class);
    if (!cls?.id || !cls.class_name) continue;
    const list = byStudent.get(row.student_id) ?? [];
    list.push({ id: cls.id, name: cls.class_name, startDate: row.start_date });
    byStudent.set(row.student_id, list);
  }
  if (byStudent.size === 0) return [];

  // ② 그 학생들 중 재원생만 — id 수백 개를 단일 .in() 에 넣으면 414 로 죽고
  //    error 를 삼키면 조용히 빈다(B3). 반드시 fetchInChunks.
  const students = await fetchInChunks<StudentRow>([...byStudent.keys()], (chunk) =>
    admin
      .from("students")
      .select("id, name, grade, school")
      .eq("tenant_id", tenantId)
      .eq("status", "enrolled")
      // 테스트 전용 학생(`학원이`, 0141a) — 집계 제외 대상이라 안 준다.
      .eq("is_test", false)
      .in("id", chunk),
  );
  students.sort((a, b) => a.id.localeCompare(b.id));

  return students.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    school: s.school,
    status: "enrolled" as const,
    classes: byStudent.get(s.id) ?? [],
  }));
}

interface ReportRow {
  id: string;
  student_id: string;
  report_date: string;
  created_at: string;
  progress: string;
  class_id: string | null;
  makeup_class_id: string | null;
}

/**
 * 진도 있는 수업보고서 — **전량 피드의 한 페이지**.
 *
 * 정렬은 (report_date, created_at, id) ASC 고정 — 소비자가 순서대로 적용하면
 * «그날의 마지막 진도»가 결정적이 된다. 증분(since)은 일부러 없다: 보고서의
 * 85.6% 가 수업일 이틀 뒤 이후 작성이고 `updated_at` 컬럼이 없어, 어떤 증분
 * 기준도 늦게 쓴 보고서를 영영 놓친다(실측 2026-08-21). 전량이 싸다(16,390행).
 *
 * ⚠️ `class_id`·`makeup_class_id` 는 **drizzle schema.ts 에 없다** — 운영 DB 에만
 *    있는 컬럼이다(0134a·0171a, information_schema 로 확인 2026-08-21).
 *    schema.ts 만 보고 「없는 컬럼」이라 지우지 말 것.
 */
export async function fetchProgressPage(
  admin: SupabaseClient,
  tenantId: string,
  offset: number,
): Promise<{ rows: ProgressRow[]; total: number }> {
  const { data, error, count } = await admin
    .from("lesson_reports")
    .select(
      "id, student_id, report_date, created_at, progress, class_id, makeup_class_id, student:student_id!inner(status, is_test, tenant_id)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .eq("student.tenant_id", tenantId)
    .eq("student.status", "enrolled")
    .eq("student.is_test", false)
    .not("progress", "is", null)
    .order("report_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PROGRESS_PAGE_SIZE - 1);
  if (error) throw new Error(`progress 조회 실패: ${error.message}`);

  const rows: ProgressRow[] = ((data ?? []) as unknown as ReportRow[]).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    reportDate: row.report_date,
    createdAt: row.created_at,
    progress: row.progress,
    classId: row.class_id,
    makeupClassId: row.makeup_class_id,
  }));
  return { rows, total: count ?? 0 };
}
