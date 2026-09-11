import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  composeEnrolled,
  type ActiveEnrollmentRow,
  type EnrolledComposition,
  type EnrolledStudentRow,
  type StudentScope,
} from "../enrolled-composition";
import type { Program } from "../program";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 재원생의 **활성 수강** 전건(end_date null · on_hold false · 학생 status=enrolled) — 조회만, 캐시 없음.
 * 🔑 운영실 갱신(서버 액션)은 React cache가 조회를 묶지 않아서, 호출부가 **한 번** 받아 순수 집계에 넘긴다.
 * ⚠️ OFFSET 페이지 안정화를 위해 unique tie-break(`id`) 정렬 필수(batch.ts 계약).
 */
export function fetchActiveEnrolledEnrollments(supabase: Supabase): Promise<ActiveEnrollmentRow[]> {
  return fetchAllPaged<ActiveEnrollmentRow>((from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, student_id, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )",
      )
      .is("end_date", null)
      .eq("on_hold", false)
      .eq("student.status", "enrolled")
      .order("id")
      .range(from, to),
  );
}

/** 요청당 1회(RSC) — 원생목록 상단 카드(getEnrolledStatCounts)와 program= 필터(getEnrolledComposition)가 같은 행을 본다. */
export const loadActiveEnrolledEnrollments = cache(async (): Promise<ActiveEnrollmentRow[]> =>
  fetchActiveEnrolledEnrollments(await createClient()),
);

/** 재원생 명단(학년·학교) — 조회만. 강사 스코프는 받아온 뒤 JS로 거른다(`.in()` 414 회피, B3). */
export function fetchEnrolledStudents(supabase: Supabase): Promise<EnrolledStudentRow[]> {
  return fetchAllPaged<EnrolledStudentRow>((from, to) =>
    supabase.from("students").select("id, grade, school").eq("status", "enrolled").order("id").range(from, to),
  );
}

/**
 * 재원생 수 — count(head), 강사 스코프면 담당 학생만. 원생목록 머리(재원 N명)·목록 총계와 **같은 조회**다.
 * 에러는 삼키지 않는다(0명 위장 금지).
 */
export async function countEnrolledStudents(supabase: Supabase, scope: StudentScope): Promise<number> {
  if (scope && scope.studentIds.length === 0) return 0;
  let q = supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "enrolled");
  if (scope) q = q.in("id", scope.studentIds);
  const { count, error } = await q;
  if (error) throw new Error(`재원생 집계 실패: ${error.message}`);
  return count ?? 0;
}

/**
 * 재원생 구성 — 원생목록 `program=` 필터의 **단일 소스**(운영실은 같은 순수 함수 composeEnrolled에 직접 받은 행을 넘긴다).
 * 강사 스코프(겸직 강사뷰)면 담당 학생 · 담당 과목 축으로 좁힌다 — getEnrolledStatCounts와 같은 규칙.
 */
export const getEnrolledComposition = cache(async (): Promise<EnrolledComposition> => {
  const supabase = await createClient();
  const [scope, settings, students, rows] = await Promise.all([
    effectiveTeacherScope(),
    getTenantSettings(),
    fetchEnrolledStudents(supabase),
    loadActiveEnrolledEnrollments(),
  ]);
  return composeEnrolled({ students, rows, scope, subjects: settings.operations.subjects });
});

/** 그 프로그램을 듣는 재원생 id — 원생목록 `program=` 필터가 운영실 팝업과 같은 수를 내게 하는 문. */
export async function getProgramStudentIds(program: Program): Promise<Set<string>> {
  const { programs } = await getEnrolledComposition();
  return new Set([...programs].flatMap(([id, set]) => (set.has(program) ? [id] : [])));
}
