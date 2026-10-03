import "server-only";
/**
 * 오늘 출결에서 **그 강사의 반** — 좌석표(`getLiveBoard`)와 휴원일 입력 요약(`getHolidayDayActivity`)이 같이 쓴다.
 *
 * 담임·그날 위임받은 반(`getTeachingClasses`) ∪ 교시를 맡은 반(`class_schedules.teacher_id`, 그 날짜에 유효한 배치).
 * 🔴 담임(`classes.teacher_id`)만 보면 부담임이 자기 화면에서 아무것도 못 본다(영어는 교시마다 담당이 갈린다 —
 *    실측 2026-08-14: 담당 교시 4개인데 담임 반은 0개인 강사).
 * 🔴 **요일로 거르지 않는다** — 그 요일에 정규 교시가 없는 반에도 보강 예약·기록이 있을 수 있다.
 * ⚠️ 두 화면이 각자 적으면 한쪽만 좁아져 같은 강사의 숫자가 갈린다 — 규칙은 여기 한 곳.
 */
import type { createClient } from "@/lib/supabase/server";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { fetchAllPaged } from "@/lib/supabase/batch";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function liveTeacherClassIds(supabase: Supabase, teacherId: string, date: string): Promise<string[]> {
  // `.or()`에 날짜를 보간하므로 형식을 여기서 확정한다(호출부 검증에만 기대지 않는다).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const [teaching, slots] = await Promise.all([
    getTeachingClasses(supabase, teacherId, date, true),
    fetchAllPaged<{ class_id: string }>((from, to) => supabase
      .from("class_schedules")
      .select("class_id")
      .eq("teacher_id", teacherId)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .order("id").range(from, to)),
  ]);
  return [...new Set([...teaching.map((c) => c.id), ...slots.map((r) => r.class_id)])];
}
