import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attendanceRate } from "@/lib/calc/attendance";

export type ClassListRow = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomName: string | null;
  isActive: boolean;
  studentCount: number;
  days: string[]; // 운영 요일 (mon, tue, ...)
  notes: string | null;
};

export type ClassListFilters = {
  subject?: string; // "all" | "math" | ...
  teacherId?: string; // "all" | uuid
  day?: string; // "all" | "mon" | ...
  q?: string;
  active?: "all" | "active" | "closed";
};

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ClassScheduleSlot = {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
};

export type ClassDetail = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomId: string | null;
  classroomName: string | null;
  isActive: boolean;
  notes: string | null;
  scheduleSlots: ClassScheduleSlot[];
  studentCount: number;
};

export type ClassStudentRow = {
  enrollmentId: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: string;
  onHold: boolean;
};

export type ClassAttendanceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

export async function getClassesList(options?: ClassListFilters): Promise<ClassListRow[]> {
  const supabase = await createClient();

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");

  if (options?.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (options?.teacherId && options.teacherId !== "all") qb = qb.eq("teacher_id", options.teacherId);
  if (options?.active === "active") qb = qb.eq("is_active", true);
  if (options?.active === "closed") qb = qb.eq("is_active", false);
  if (options?.q) {
    const term = options.q.trim();
    if (term) qb = qb.ilike("class_name", `%${term}%`);
  }

  const { data: classes } = await qb;
  if (!classes) return [];

  // 학생 수 카운트
  const classIds = classes.map((c) => c.id);
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id")
    .is("end_date", null);

  const counts = new Map<string, number>();
  for (const e of enrollments ?? []) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  // 요일 unique
  const daysByClass = new Map<string, Set<string>>();
  if (classIds.length > 0) {
    const { data: scheds } = await supabase
      .from("class_schedules")
      .select("class_id, day_of_week")
      .in("class_id", classIds);
    for (const s of scheds ?? []) {
      const set = daysByClass.get(s.class_id) ?? new Set<string>();
      set.add(s.day_of_week);
      daysByClass.set(s.class_id, set);
    }
  }

  const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  let rows = classes.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    const days = Array.from(daysByClass.get(c.id) ?? []).sort(
      (a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b),
    );
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      studentCount: counts.get(c.id) ?? 0,
      days,
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  // 요일 필터 (in-memory)
  if (options?.day && options.day !== "all") {
    rows = rows.filter((r) => r.days.includes(options.day!));
  }

  return rows;
}

/**
 * 수업목록 Stat 카드용 경량 집계 — head:true 카운트만(행 fetch 없이, 전건 enrollment 절단도 회피).
 * totalSeats = end_date null 활성 수강 총합.
 */
export async function getClassesStats(): Promise<{ total: number; active: number; totalSeats: number }> {
  const supabase = await createClient();
  const [total, active, seats] = await Promise.all([
    supabase.from("classes").select("*", { count: "exact", head: true }),
    supabase.from("classes").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("enrollments").select("*", { count: "exact", head: true }).is("end_date", null),
  ]);
  return { total: total.count ?? 0, active: active.count ?? 0, totalSeats: seats.count ?? 0 };
}

/**
 * 수업목록 서버 페이지네이션. subject/teacher/active/q는 SQL, day는 class_schedules에서 해당 요일 수업 id를
 * 먼저 풀어 .in()으로 좁힌다(총계 정확 — C2 한계 해소). 학생수·요일은 그 페이지 수업 id로만 스코프 집계.
 */
export async function getClassesPage(
  options: ClassListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: ClassListRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;

  let dayClassIds: string[] | null = null;
  if (options?.day && options.day !== "all") {
    const { data: scheds } = await supabase
      .from("class_schedules")
      .select("class_id")
      .eq("day_of_week", options.day);
    dayClassIds = [...new Set((scheds ?? []).map((s) => s.class_id))];
    if (dayClassIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
      { count: "exact" },
    )
    .order("class_name");
  if (options?.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (options?.teacherId && options.teacherId !== "all") qb = qb.eq("teacher_id", options.teacherId);
  if (options?.active === "active") qb = qb.eq("is_active", true);
  if (options?.active === "closed") qb = qb.eq("is_active", false);
  if (options?.q) {
    const term = options.q.trim();
    if (term) qb = qb.ilike("class_name", `%${term}%`);
  }
  if (dayClassIds) qb = qb.in("id", dayClassIds);
  qb = qb.range(from, from + pageSize - 1);

  const { data: classes, count } = await qb;
  const pageClasses = classes ?? [];
  const classIds = pageClasses.map((c) => c.id);

  const counts = new Map<string, number>();
  const daysByClass = new Map<string, Set<string>>();
  if (classIds.length > 0) {
    const [{ data: enrollments }, { data: scheds }] = await Promise.all([
      supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", classIds),
      supabase.from("class_schedules").select("class_id, day_of_week").in("class_id", classIds),
    ]);
    for (const e of enrollments ?? []) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    for (const s of scheds ?? []) {
      const set = daysByClass.get(s.class_id) ?? new Set<string>();
      set.add(s.day_of_week);
      daysByClass.set(s.class_id, set);
    }
  }

  const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const rows = pageClasses.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    const days = Array.from(daysByClass.get(c.id) ?? []).sort(
      (a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b),
    );
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      studentCount: counts.get(c.id) ?? 0,
      days,
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  return { rows, total: count ?? rows.length };
}

export async function getClassTeacherOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role")
    .in("system_role", ["teacher", "manager", "master"])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({ id: u.id, name: u.display_name }));
}

export async function getClassDetail(id: string): Promise<ClassDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, notes,
       teacher_id, classroom_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  const { data: schedules } = await supabase
    .from("class_schedules")
    .select("id, day_of_week, start_time, end_time, valid_from, valid_to")
    .eq("class_id", id)
    .order("day_of_week")
    .order("start_time");

  const { count: studentCount } = await supabase
    .from("enrollments")
    .select("*", { count: "exact", head: true })
    .eq("class_id", id)
    .is("end_date", null);

  const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
    | { display_name?: string }
    | undefined;
  const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
    | { name?: string }
    | undefined;

  return {
    id: c.id,
    className: c.class_name,
    subject: c.subject,
    teacherId: c.teacher_id,
    teacherName: teacher?.display_name ?? null,
    classroomId: c.classroom_id,
    classroomName: room?.name ?? null,
    isActive: c.is_active,
    notes: c.notes,
    scheduleSlots: (schedules ?? []).map((s) => ({
      id: s.id,
      dayOfWeek: s.day_of_week as DayOfWeek,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from,
      validTo: s.valid_to,
    })),
    studentCount: studentCount ?? 0,
  };
}

export async function getClassStudents(classId: string): Promise<ClassStudentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, on_hold,
       student:student_id ( id, name, grade, school )`,
    )
    .eq("class_id", classId)
    .is("end_date", null)
    .order("start_date", { ascending: false });

  if (!data) return [];

  return data
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null; school: string | null }
        | undefined;
      if (!s) return null;
      return {
        enrollmentId: e.id,
        studentId: s.id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
        onHold: e.on_hold,
      } satisfies ClassStudentRow;
    })
    .filter((r): r is ClassStudentRow => r !== null);
}

export async function getClassAttendanceStats(
  classId: string,
  days = 30,
): Promise<ClassAttendanceStats> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("class_id", classId)
    .gte("session_date", since);

  const rows = data ?? [];
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const late = rows.filter((r) => r.status === "late").length;
  const excused = rows.filter((r) => r.status === "excused").length;
  return {
    total,
    present,
    absent,
    late,
    excused,
    rate: attendanceRate(present, total),
  };
}
