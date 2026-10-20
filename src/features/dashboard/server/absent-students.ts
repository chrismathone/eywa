import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { loadClassAxisRows } from "@/features/attendance/server/teacher-axis-queries";
import {
  foldAbsentStudents,
  scopeAbsentDay,
  type AbsentDay,
  type AbsentRecordRow,
} from "../absent-students";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 그날 결석 판정(결석 학생 / 일부 교시 결석) — 출석부 `?status=absent`, 데스크 '어제 결석' 배너,
 * 일일 브리핑 '어제 결석'의 **단일 소스**. 규칙은 [absent-students.ts] `foldAbsentStudents` 한 벌.
 * ⚠️ 기준일은 호출부가 넘긴다 — 출석부는 URL의 그 날짜, 브리핑·데스크 배너는 어제(`asOf`).
 *
 * 🔴 상태로 좁혀 조회하지 않는다 — 결석을 출석으로 고친 칸은 최신 행만 봐야 결석이 아니게 되고, '한 교시라도 왔는가'도
 *    다른 상태의 칸을 봐야 안다. 그날 전 칸을 받아(하루치 · 페이징) 최신 정정을 가린 뒤 접는다.
 * ⚠️ 교시(`slot_start`)도 싣는다 — 같은 날 두 교시는 서로 다른 칸이다(0196a).
 * @param deps cron(admin) 경로 — admin은 RLS 우회라 tenantId 필터가 필수다.
 */
export async function getAbsentStudents(
  date: string,
  deps?: { supabase: Supabase; tenantId?: string },
): Promise<AbsentDay> {
  const supabase = deps?.supabase ?? (await createClient());
  const rows = await fetchAllPaged<AbsentRecordRow>((from, to) => {
    let q = supabase
      .from("attendance_records")
      .select(
        // note는 **사전 통보 판정에만** 쓴다 — 사유 원문은 화면에 내보내지 않는다(건강·가정사가 그대로 적혀 있다).
        "id, student_id, class_id, session_date, slot_start, status, recorded_at, note, student:student_id ( name ), class:class_id ( subject, class_name )",
      )
      .eq("session_date", date);
    if (deps?.tenantId) q = q.eq("tenant_id", deps.tenantId);
    return q.order("recorded_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  return foldAbsentStudents(rows);
}

/**
 * 보는 사람의 강사 스코프를 건 결석 판정 — 출석부 `?status=absent`가 쓴다.
 * `teacherId`(= effectiveTeacherId: 실 강사·겸직 강사뷰·'다른 강사 뷰'는 그 강사)가 있으면 그날 그 강사가 가르치는 반
 * (teacher-axis: 담임 ∪ 교시 담당 — 출석부 반 목록 `loadVisibleClassAxisRows`와 같은 규칙)으로 좁힌다. 사무실(null)은 전체.
 */
export async function getScopedAbsentStudents(date: string, teacherId: string | null): Promise<AbsentDay> {
  const [day, classRows] = await Promise.all([
    getAbsentStudents(date),
    teacherId ? loadClassAxisRows(date, date) : Promise.resolve(null),
  ]);
  if (!teacherId || !classRows) return day;
  return scopeAbsentDay(day, new Set(classRows.filter((c) => c.taughtBy.includes(teacherId)).map((c) => c.id)));
}
