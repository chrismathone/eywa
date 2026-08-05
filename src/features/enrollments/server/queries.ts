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

/**
 * 반 폼의 강의실 **선택지** — 보관(숨김)된 강의실은 제외한다(0182a).
 *
 * ⚠️ 수정 화면은 반드시 `keepForClassId`를 넘길 것. 그 반에 **이미 배정된** 강의실이 보관됐을 때
 *    선택지에서 빼 버리면, 컨트롤드 select가 값을 못 찾아 빈 칸이 되고 **그대로 저장하는 순간 배정이
 *    조용히 사라진다** — "숨겨도 배정은 그대로"라는 이 기능의 전제를 화면이 깨는 셈이다
 *    (담임 select가 같은 이유로 이미 같은 방어를 하고 있다: classes/[id]/edit 주석).
 *    반 조회는 여기서 **병렬로** 처리하므로 호출부에 왕복이 추가되지 않는다.
 */
export async function getClassroomOptions(opts?: {
  keepForClassId?: string;
}): Promise<ClassroomOption[]> {
  const supabase = await createClient();
  const [{ data }, keepRes] = await Promise.all([
    supabase.from("classrooms").select("id, name, capacity, archived_at").order("name"),
    opts?.keepForClassId
      ? supabase.from("classes").select("classroom_id").eq("id", opts.keepForClassId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const keepId = (keepRes.data as { classroom_id: string | null } | null)?.classroom_id ?? null;
  return (data ?? [])
    .filter((r) => r.archived_at == null || (keepId != null && r.id === keepId))
    .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity }));
}
