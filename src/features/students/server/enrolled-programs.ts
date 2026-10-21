import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  activeStudentIds,
  composeEnrolled,
  compositionStudentIds,
  notYetStartedStudentIds,
  type ActiveEnrollmentRow,
  type EnrolledComposition,
  type EnrolledStudentRow,
  type StudentScope,
} from "../enrollment/enrolled-composition";
import type { Program } from "../enrollment/program";
import { NO_SUBJECT, type StudentLevel, type StudentMixFilter } from "../list-filter-values";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 재원생의 **활성 수강** 전건(end_date null · on_hold false · 학생 status=enrolled) — 조회만, 캐시 없음.
 * 🔑 운영실 갱신(서버 액션)은 React cache가 조회를 묶지 않아서, 호출부가 **한 번** 받아 순수 집계에 넘긴다.
 * ⚠️ OFFSET 페이지 안정화를 위해 unique tie-break(`id`) 정렬 필수(batch.ts 계약).
 */
export function fetchActiveEnrolledEnrollments(
  supabase: Supabase,
  /**
   * false = 학생 상태를 가리지 않는다 — 원생목록 상태가 재원이 아닐 때(전체·휴원·예비) 수강 과목 = '미수강'의 재료.
   * 🔑 줄 조건(종료 안 됨 · 휴원 아님)은 같다 — 재원생만 떼어 보면 기본값(true)과 **같은 줄**이다.
   */
  enrolledOnly = true,
): Promise<ActiveEnrollmentRow[]> {
  return fetchAllPaged<ActiveEnrollmentRow>((from, to) => {
    let q = supabase
      .from("enrollments")
      // `start_date` — '실시간 재원생'(원장 2026-09-16)의 재료. 🔴 여기서 `.lte(start_date, today)`로 거르지
      // **않는다**: 아직 안 시작한 수강만 가진 학생이 누구인지 알려면 그 행도 받아야 한다
      // (`notYetStartedStudentIds`). 거르는 것은 순수 함수 쪽 한 곳이다.
      .select(
        "id, student_id, class_id, start_date, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )",
      )
      .is("end_date", null)
      .eq("on_hold", false);
    if (enrolledOnly) q = q.eq("student.status", "enrolled");
    return q.order("id").range(from, to);
  });
}

/**
 * 재원생의 **종료일이 오늘 이후로 적힌** 활성 수강(특강 기간 · 반이동 예약 전의 원래 반 · 오늘 끝나는 수강 — 휴원 아님 · 학생 status=enrolled).
 * 위 `fetchActiveEnrolledEnrollments`(종료일 없는 줄)에 더해 **강좌수**(`summarizeCourses` — 오늘 듣는 반)만 쓴다(적대 리뷰 2026-10-20:
 * 진행 중인 특강이 '지금 듣는 반'에서 빠졌다). 재원생 구성·원생목록은 종전대로 종료일 없는 줄만 본다.
 */
export function fetchEndingEnrolledEnrollments(supabase: Supabase, today: string): Promise<ActiveEnrollmentRow[]> {
  return fetchAllPaged<ActiveEnrollmentRow>((from, to) =>
    supabase
      .from("enrollments")
      .select("id, student_id, class_id, start_date, end_date, is_transferred, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )")
      .gte("end_date", today)
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

/** 학생 상태를 가리지 않은 활성 수강 전건(요청당 1회) — 원생목록 상태가 재원이 아닐 때의 '미수강' 판정 재료. */
const loadActiveEnrollmentsAnyStatus = cache(async (): Promise<ActiveEnrollmentRow[]> =>
  fetchActiveEnrolledEnrollments(await createClient(), false),
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
export async function countEnrolledStudents(
  supabase: Supabase,
  scope: StudentScope,
  /**
   * 아직 하나도 시작 안 한 학생 — '실시간 재원생'(원장 2026-09-16)이라 총원에서도 뺀다.
   * 🔴 **카드 숫자와 목록이 같은 집합을 봐야 한다** — 여기만 빼고 목록을 안 빼면 "338명"이라 적어 놓고
   *    339줄이 뜬다(원장이 지적한 바로 그 종류의 불일치). `getStudentsPage`도 같은 집합을 뺀다.
   */
  excludeIds?: ReadonlySet<string>,
): Promise<number> {
  if (scope && scope.studentIds.length === 0) return 0;
  let q = supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "enrolled");
  if (scope) q = q.in("id", scope.studentIds);
  // 대개 0~수명이라 URL이 짧다(414 걱정 없음) — 비면 필터 자체를 안 건다.
  if (excludeIds && excludeIds.size > 0) q = q.not("id", "in", `(${[...excludeIds].join(",")})`);
  const { count, error } = await q;
  if (error) throw new Error(`재원생 집계 실패: ${error.message}`);
  return count ?? 0;
}

/**
 * 아직 한 과목도 시작 안 한 재원생 id — 재원생 총원·목록·과목 집계가 **같은 집합**을 뺀다.
 * 요청당 1회(활성 수강 전건은 `loadActiveEnrolledEnrollments`가 이미 캐시한다).
 */
export const getNotStartedStudentIds = cache(async (): Promise<Set<string>> =>
  notYetStartedStudentIds(await loadActiveEnrolledEnrollments(), kstToday()),
);

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
  return composeEnrolled({
    students,
    rows,
    scope,
    subjects: settings.operations.subjects,
    today: kstToday(),
  });
});

/** 그 프로그램을 듣는 재원생 id — 원생목록 `program=` 필터가 운영실 팝업과 같은 수를 내게 하는 문. */
export async function getProgramStudentIds(program: Program): Promise<Set<string>> {
  const { programs } = await getEnrolledComposition();
  return new Set([...programs].flatMap(([id, set]) => (set.has(program) ? [id] : [])));
}

/** 운영실 '재원생 구성' 막대 조각(학교급 × 수강 구성) — 원생목록 `level=`·`mix=`가 막대와 같은 수를 내게 하는 문. */
export async function getCompositionStudentIds(filter: {
  levels: readonly StudentLevel[];
  mixes: readonly StudentMixFilter[];
}): Promise<Set<string>> {
  return compositionStudentIds(await getEnrolledComposition(), filter);
}

/**
 * 수강 과목 필터에 **'미수강'이 섞였을 때**의 판정 — 고른 과목 중 하나라도 듣거나(합집합) 지금 수강 중인 과목이 하나도 없는 학생.
 * '미수강'이 없으면 null(과목은 종전대로 embed 조인으로 건다 — 이 함수를 안 탄다).
 *
 * 🔑 '미수강' = `activeStudentIds`의 여집합 — 운영실 '미수강' 막대(`composeEnrolled().active`의 여집합)와 **같은 판정**이고,
 *    상태=재원이면 재료도 같은 요청 캐시(`loadActiveEnrolledEnrollments`)다 → 막대 숫자 = 목록 건수(원장 2026-09-28).
 * 🔑 과목 쪽은 embed 필터와 같은 뜻(종료 안 됨 · 휴원 아님 · 시작일 무관)이다 — '미수강'이 섞였다고 수학의 뜻이 바뀌면 안 된다.
 * ⚠️ 상태가 재원이 아니면(전체·휴원·예비) 학생 상태를 안 가린 활성 수강으로 판정한다(휴원생은 수강이 쉬는 중이라 대개 '미수강').
 */
export async function getSubjectFilterKeep(
  subjects: readonly string[],
  enrolledOnly: boolean,
): Promise<((id: string) => boolean) | null> {
  if (!subjects.includes(NO_SUBJECT)) return null;
  const real = new Set(subjects.filter((s) => s !== NO_SUBJECT));
  const [scope, rows] = await Promise.all([
    effectiveTeacherScope(),
    enrolledOnly ? loadActiveEnrolledEnrollments() : loadActiveEnrollmentsAnyStatus(),
  ]);
  const active = activeStudentIds(rows, scope, kstToday());
  const takes = new Set<string>();
  if (real.size > 0) {
    for (const row of rows) {
      const klass = Array.isArray(row.class) ? row.class[0] : row.class;
      if (klass?.subject && real.has(klass.subject)) takes.add(row.student_id);
    }
  }
  return (id) => takes.has(id) || !active.has(id);
}
