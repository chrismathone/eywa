import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { assembleMathParams } from "@/features/exports/math-timetable/assemble";
import { getClassTeacherOptions } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import type { PlanContext } from "@/features/timetable/import/math-grid/apply-plan";
import type { ExportedClass } from "@/features/timetable/import/math-grid/schedule-diff";

/**
 * 수학 격자 가져오기가 견줄 "지금 DB" — 수학 반(이름·종강 예정일·수업 요일)·학생 명부·반을 맡을 수 있는 직원·강의실·
 * 수학 반의 끝나지 않은 수강·교시 시각.
 *
 * 일곱 조회는 서로의 결과를 안 쓴다 → 한꺼번에(B4). 전부 "명단에 있는가"를 묻는 데 쓰이므로 잘리면 조용히 틀린다
 * → 페이지네이션 + id 정렬(B2, batch.ts 계약). 읽기 전용이고 RLS(테넌트 격리) 아래에서 돈다.
 * 시트의 기준 주를 몰라도 읽을 수 있다 → 호출부가 시트 기록 탭을 읽는 동안 함께 돌린다.
 */
export async function loadMathGridPlanContext(): Promise<PlanContext> {
  const supabase = await createClient();
  const today = kstToday();
  const [classes, students, teachers, rooms, enrollments, settings, schedules] = await Promise.all([
    fetchAllPaged<{ id: string; class_name: string; is_active: boolean; closed_at: string | null }>((from, to) =>
      supabase.from("classes").select("id, class_name, is_active, closed_at").eq("subject", "math").order("id").range(from, to),
    ),
    fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null; status: string | null }>(
      (from, to) => supabase.from("students").select("id, name, school, grade, status").order("id").range(from, to),
    ),
    // 반을 맡길 수 있는 재직자 — 새 반·인수인계 드롭다운과 같은 소스(역할 목록을 여기 새로 적지 않는다).
    getClassTeacherOptions(),
    fetchAllPaged<{ id: string; name: string; archived_at: string | null }>((from, to) =>
      supabase.from("classrooms").select("id, name, archived_at").order("id").range(from, to),
    ),
    // 끝나지 않은 수강 = 종료일이 없거나 아직 안 지났다(종료일은 그날부터 빠지는 날 — 반열림 구간).
    fetchAllPaged<{ id: string; student_id: string; class_id: string; end_date: string | null }>((from, to) =>
      supabase
        .from("enrollments")
        .select("id, student_id, class_id, end_date")
        .or(`end_date.is.null,end_date.gt.${today}`)
        .order("id")
        .range(from, to),
    ),
    getTenantSettings(),
    // 지금·앞으로 유효한 수업 시간(이 표는 끝난 이력도 함께 담는다 — [[#88]]). 등원 요일을 견줄 "그 반의 실제 요일".
    fetchAllPaged<{ id: string; class_id: string; day_of_week: string }>((from, to) =>
      supabase
        .from("class_schedules")
        .select("id, class_id, day_of_week")
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order("id")
        .range(from, to),
    ),
  ]);
  // 직원 조회는 실패해도 빈 목록을 돌려준다 — 그대로 두면 새 반마다 "직원 명단에 없는 이름"이라는 틀린 이유가 뜬다.
  if (teachers.length === 0) throw new Error("직원 명단을 읽지 못했습니다");

  const periods = settingsToPeriodsConfig(settings.operations);
  const mathIds = new Set(classes.map((c) => c.id));
  const daysByClass = new Map<string, Set<string>>();
  for (const s of schedules) daysByClass.set(s.class_id, (daysByClass.get(s.class_id) ?? new Set()).add(s.day_of_week));
  return {
    classes: classes.map((c) => ({
      id: c.id,
      name: c.class_name,
      open: c.is_active && !(c.closed_at && c.closed_at <= today),
      closesOn: c.closed_at && c.closed_at > today ? c.closed_at : null,
      days: [...(daysByClass.get(c.id) ?? [])],
    })),
    students,
    teachers: teachers.map((t) => ({ id: t.id, name: t.name })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, archived: !!r.archived_at })),
    // 🔴 수학 반의 수강만 — 이 가져오기가 다른 과목 수강을 볼 일도, 닫을 일도 없다.
    enrollments: enrollments
      .filter((e) => mathIds.has(e.class_id))
      .map((e) => ({ id: e.id, studentId: e.student_id, classId: e.class_id, endDate: e.end_date })),
    periods: { weekday: weekdayTableFor("math", periods), weekend: periods.weekend },
  };
}

/**
 * **익스포터가 그 주에 그릴 반 목록** — 기존 반의 시간·강사가 시트와 다른지 견주는 상대.
 * `referenceDate` = 시트를 보낼 때의 기준 월요일(내보내기 기록) — 그 주의 배치와 견줘야 시트와 같은 그림이다.
 */
export async function loadMathExportedClasses(referenceDate: string): Promise<ExportedClass[]> {
  const weekOf = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : undefined;
  const [settings, slots] = await Promise.all([
    getTenantSettings(),
    getWeeklyScheduleWithStudents({ referenceDate: weekOf, subject: "math" }),
  ]);
  const drawn = assembleMathParams(slots, {
    referenceMonday: new Date(`${weekOf ?? kstToday()}T00:00:00`),
    periodsConfig: settingsToPeriodsConfig(settings.operations),
  }).filteredClasses;
  return drawn.map((c) => ({ id: c.id, teacher: c.teacher, schedule: c.schedule, slotTeachers: c.slotTeachers }));
}
