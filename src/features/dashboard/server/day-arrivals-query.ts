import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import type { ProgramSubject } from "@/features/students/program";
import {
  resolveDayArrivals,
  type DayArrivals,
  type DayEnrollmentRow,
  type FirstClassStudent,
} from "../day-arrivals";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type One<T> = T | T[] | null;

/**
 * 그날 **시작·종료하는 수강이 있는 학생들의 수강 전건** — 왕복 2회.
 * ① 그날 시작/종료하는 수강에서 **학생 id만** 뽑고 ② 그 학생들의 수강 **전건**을 받는다(판정은 순수 함수).
 * 🔴 ①만으로 판정하면 반을 하나 더 받은 학생이 '첫 수업', 반 하나만 뺀 학생이 '마지막 수업'이 된다
 *    (실측 2026-09-09 — day-arrivals.ts 주석).
 * 🔴 상한을 걸지 않는다 — 시간표 컷오버 날(9/1 등)엔 반이동으로 수백 건이 함께 시작·종료해서 `.limit()`이면
 *    **조용히 잘린다**([[#54]]). ②는 `fetchAllPagedInChunks`(청크 × 페이징 — 청크 안 1000행 절단 방지).
 * @param tenantId cron(admin) 경로 — admin은 RLS 우회라 테넌트 필터 필수.
 */
export async function loadDayEnrollmentRows(
  supabase: Supabase,
  date: string,
  tenantId?: string,
): Promise<DayEnrollmentRow[]> {
  const scope = <T>(query: T): T =>
    tenantId
      ? ((query as unknown as { eq(column: string, value: unknown): unknown }).eq("tenant_id", tenantId) as T)
      : query;
  const candidates = await fetchAllPaged<{ student_id: string }>((from, to) =>
    scope(
      supabase.from("enrollments").select("student_id").or(`start_date.eq.${date},end_date.eq.${date}`),
    )
      // OFFSET 페이지 안정화 — unique tie-break order 필수(batch.ts 계약)
      .order("id")
      .range(from, to),
  );
  const studentIds = [...new Set(candidates.map((row) => row.student_id))];
  if (studentIds.length === 0) return [];

  const rows = await fetchAllPagedInChunks<{
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
    is_transferred_in: boolean;
    student: One<{ name?: string }>;
    class: One<{ subject?: string | null }>;
  }>(studentIds, (chunk, from, to) =>
    scope(
      supabase
        .from("enrollments")
        .select(
          "student_id, start_date, end_date, on_hold, is_transferred, is_transferred_in, student:student_id ( name ), class:class_id ( subject )",
        )
        .in("student_id", chunk),
    )
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => {
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) ?? undefined;
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    return {
      studentId: row.student_id,
      studentName: student?.name ?? "",
      startDate: row.start_date,
      endDate: row.end_date,
      isTransferred: !!row.is_transferred,
      isTransferredIn: !!row.is_transferred_in,
      onHold: !!row.on_hold,
      subject: klass?.subject ?? null,
    };
  });
}

/**
 * 그날 **첫 수업 · 마지막 수업** — 한 번 받은 수강 전건(`loadDayEnrollmentRows`)으로 둘 다 판정한다(왕복 2회).
 * 🔴 `starting`이 **첫 수업의 단일 소스**다 — 운영실 '오늘첫수업' 카드·팝업, 원생목록·엑셀 `first=`(getFirstClassStudents),
 *    일일 브리핑 '오늘 첫 수업'이 **모두 이 결과 전체**(첫 등원 + 새 과목)를 쓴다. 같은 이름의 숫자는 어디서나 같다.
 * @param subjects 학원설정 `operations.subjects` — 새 과목 묶음 판정(programOf와 같은 묶음).
 *    약속으로 넘기면 조회와 함께 기다린다(판정에만 쓰는 값이라 조회를 붙잡지 않는다, B4).
 */
export async function getDayArrivals(
  date: string,
  subjects: readonly ProgramSubject[] | Promise<readonly ProgramSubject[]>,
  deps?: { supabase: Supabase; tenantId?: string },
): Promise<DayArrivals> {
  const supabase = deps?.supabase ?? (await createClient());
  const [rows, list] = await Promise.all([loadDayEnrollmentRows(supabase, date, deps?.tenantId), subjects]);
  return resolveDayArrivals(rows, date, list);
}

/** 그날 **첫 수업** 학생(첫 등원 + 새 과목) — `getDayArrivals`의 `starting` 그대로(카드·팝업·원생목록·엑셀 `first=`). */
export async function getFirstClassStudents(
  date: string,
  subjects: readonly ProgramSubject[],
  deps?: { supabase: Supabase; tenantId?: string },
): Promise<FirstClassStudent[]> {
  return (await getDayArrivals(date, subjects, deps)).starting;
}
