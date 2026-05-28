import "server-only";
import { createClient } from "@/lib/supabase/server";

export type EnrollmentSchedule = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
};

/**
 * 학생의 활성 enrollments의 모든 schedule.
 * 신규 반 배정 시 UI에서 시간 충돌을 미리 경고할 때 사용.
 */
export async function getStudentActiveSchedules(
  studentId: string,
): Promise<EnrollmentSchedule[]> {
  const supabase = await createClient();
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id")
    .eq("student_id", studentId)
    .is("end_date", null);

  if (!enrollments || enrollments.length === 0) return [];

  const classIds = enrollments.map((e) => e.class_id);
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select(
      `class_id, day_of_week, start_time, end_time,
       class:class_id ( class_name, subject )`,
    )
    .in("class_id", classIds);

  return (schedules ?? []).map((s) => {
    const cls = (Array.isArray(s.class) ? s.class[0] : s.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    return {
      classId: s.class_id,
      className: cls?.class_name ?? "?",
      subject: cls?.subject ?? "?",
      dayOfWeek: s.day_of_week,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
    };
  });
}

/**
 * 학생의 활성 schedules와 후보 반의 schedules 비교.
 * 시간이 겹치면 충돌 정보 반환.
 */
export async function detectStudentScheduleConflicts(
  studentId: string,
  candidateClassId: string,
): Promise<{ day: string; time: string; existingClass: string }[]> {
  const supabase = await createClient();

  const existing = await getStudentActiveSchedules(studentId);
  if (existing.length === 0) return [];

  const { data: candidates } = await supabase
    .from("class_schedules")
    .select("day_of_week, start_time, end_time")
    .eq("class_id", candidateClassId);

  if (!candidates || candidates.length === 0) return [];

  const conflicts: { day: string; time: string; existingClass: string }[] = [];
  for (const c of candidates) {
    const cStart = String(c.start_time).slice(0, 5);
    const cEnd = String(c.end_time).slice(0, 5);
    for (const e of existing) {
      if (e.dayOfWeek !== c.day_of_week) continue;
      if (cStart < e.endTime && cEnd > e.startTime) {
        conflicts.push({
          day: c.day_of_week,
          time: `${cStart}~${cEnd}`,
          existingClass: e.className,
        });
      }
    }
  }
  return conflicts;
}

export type ClassroomOption = {
  id: string;
  name: string;
  capacity: number | null;
};

export async function getClassroomOptions(): Promise<ClassroomOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classrooms")
    .select("id, name, capacity")
    .order("name");
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity }));
}
