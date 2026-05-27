import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ScheduleSlot = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string; // "mon" ~ "sun"
  startTime: string; // "16:00:00"
  endTime: string;
  teacherName: string | null;
  classroomName: string | null;
  studentCount: number;
};

async function fetchSlots(): Promise<ScheduleSlot[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id,
       class:class_id (
         id, class_name, subject,
         teacher:teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .order("start_time");

  if (!data) return [];

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id")
    .is("end_date", null);

  const counts = new Map<string, number>();
  for (const e of enrollments ?? []) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  return data.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | {
          id?: string;
          class_name?: string;
          subject?: string;
          teacher?: { display_name?: string } | { display_name?: string }[];
          classroom?: { name?: string } | { name?: string }[];
        }
      | undefined;
    const teacherField = klass?.teacher;
    const teacher = (Array.isArray(teacherField) ? teacherField[0] : teacherField) as
      | { display_name?: string }
      | undefined;
    const roomField = klass?.classroom;
    const room = (Array.isArray(roomField) ? roomField[0] : roomField) as
      | { name?: string }
      | undefined;
    return {
      id: r.id,
      classId: r.class_id,
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      studentCount: counts.get(r.class_id) ?? 0,
    };
  });
}

export async function getWeeklySchedule(): Promise<ScheduleSlot[]> {
  return fetchSlots();
}

export type StudentLine = { name: string; grade: string | null; school: string | null };
export type ScheduleSlotWithStudents = ScheduleSlot & { students: StudentLine[] };

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는
 * 학생 리스트 (이름·학년·학교) 데이터.
 */
export async function getWeeklyScheduleWithStudents(): Promise<ScheduleSlotWithStudents[]> {
  const slots = await fetchSlots();
  if (slots.length === 0) return [];

  const classIds = Array.from(new Set(slots.map((s) => s.classId)));
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("enrollments")
    .select("class_id, student:student_id ( name, grade, school )")
    .in("class_id", classIds)
    .is("end_date", null);

  const byClass = new Map<string, StudentLine[]>();
  for (const r of rows ?? []) {
    const s = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { name?: string; grade?: string | null; school?: string | null }
      | undefined;
    if (!s?.name) continue;
    const list = byClass.get(r.class_id) ?? [];
    list.push({ name: s.name, grade: s.grade ?? null, school: s.school ?? null });
    byClass.set(r.class_id, list);
  }

  return slots.map((s) => ({ ...s, students: byClass.get(s.classId) ?? [] }));
}

const DOW_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export type TodaySlot = ScheduleSlot & { status: "done" | "ongoing" | "upcoming" };

export async function getTodaySchedule(): Promise<TodaySlot[]> {
  const all = await fetchSlots();
  const now = new Date();
  const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
  const todaysSlots = all.filter((s) => s.dayOfWeek === todayKey);
  if (todaysSlots.length === 0) return [];

  const hh = now.getHours();
  const mm = now.getMinutes();
  const nowMins = hh * 60 + mm;

  function toMins(hms: string): number {
    const [h, m] = hms.split(":");
    return Number(h) * 60 + Number(m);
  }

  return todaysSlots
    .slice()
    .sort((a, b) => toMins(a.startTime) - toMins(b.startTime))
    .map((s) => {
      const start = toMins(s.startTime);
      const end = toMins(s.endTime);
      let status: TodaySlot["status"] = "upcoming";
      if (nowMins >= end) status = "done";
      else if (nowMins >= start) status = "ongoing";
      return { ...s, status };
    });
}

export function dayOfWeekIndex(key: string): number {
  return DOW_INDEX[key] ?? 7;
}
