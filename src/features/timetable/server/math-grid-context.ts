import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import type { PreviewContext } from "@/features/timetable/import/math-grid/build-preview";

/**
 * 수학 격자 미리보기가 견줄 "지금 DB" — 반 이름·학생 명부·강사·강의실·수강 중인 (학생, 반)·교시 시각.
 * 여섯 조회는 서로의 결과를 안 쓴다 → 한꺼번에(B4). 전부 "명단에 있는가"를 묻는 데 쓰이므로 잘리면
 * 조용히 틀린다 → 페이지네이션 + id 정렬(B2, batch.ts 계약). 읽기 전용이고 RLS(테넌트 격리) 아래에서 돈다.
 */
export async function loadMathGridContext(): Promise<PreviewContext> {
  const supabase = await createClient();
  const today = kstToday();
  const [classes, students, users, rooms, enrollments, settings] = await Promise.all([
    fetchAllPaged<{ id: string; class_name: string; is_active: boolean }>((from, to) =>
      supabase.from("classes").select("id, class_name, is_active").eq("subject", "math").order("id").range(from, to),
    ),
    fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null; status: string | null }>(
      (from, to) => supabase.from("students").select("id, name, school, grade, status").order("id").range(from, to),
    ),
    fetchAllPaged<{ display_name: string | null }>((from, to) =>
      supabase.from("users").select("display_name").order("id").range(from, to),
    ),
    fetchAllPaged<{ name: string }>((from, to) =>
      supabase.from("classrooms").select("name").order("id").range(from, to),
    ),
    // 수강 중 = 종료일이 없거나 아직 안 지났다(종료일은 그날부터 빠지는 날 — 반열림 구간).
    fetchAllPaged<{ student_id: string; class_id: string }>((from, to) =>
      supabase
        .from("enrollments")
        .select("student_id, class_id")
        .or(`end_date.is.null,end_date.gt.${today}`)
        .order("id")
        .range(from, to),
    ),
    getTenantSettings(),
  ]);

  const periods = settingsToPeriodsConfig(settings.operations);
  return {
    classes: classes.map((c) => ({ id: c.id, name: c.class_name, active: c.is_active })),
    students,
    teacherNames: users.map((u) => u.display_name ?? "").filter(Boolean),
    roomNames: rooms.map((r) => r.name),
    enrolled: new Set(enrollments.map((e) => `${e.student_id}:${e.class_id}`)),
    periods: { weekday: weekdayTableFor("math", periods), weekend: periods.weekend },
  };
}
