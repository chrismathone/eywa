import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { attendanceRate } from "@/lib/calc/attendance";

/** 운영 요일 + 그 요일의 최초 시작시각(HH:MM). 같은 요일 여러 교시면 가장 이른 시각. */
export type ClassDaySlot = { day: string; start: string | null };

export type ClassListRow = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomName: string | null;
  isActive: boolean;
  studentCount: number;
  days: ClassDaySlot[]; // 운영 요일(+시작시각), 요일순 정렬
  notes: string | null;
};

/** 수업목록 정렬 기준 — ijw 패리티(수업명/학생수/강사명). */
export type ClassSort = "name" | "students" | "teacher";

export type ClassListFilters = {
  subject?: string; // "all" | "math" | ...
  teacherId?: string; // "all" | uuid
  day?: string; // "all" | "mon" | ... (getClassesList 단일 요일 — 레거시)
  days?: string[]; // 다중 요일(getClassesPage) — 하나라도 포함하면 매칭(ijw 의미)
  q?: string;
  active?: "all" | "active" | "closed";
  sort?: ClassSort; // 미지정 시 "name"
};

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ClassScheduleSlot = {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  // 교시별 오버라이드 — null이면 반의 담임/기본 강의실 상속.
  teacherId: string | null;
  classroomId: string | null;
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
  /** 분리등원 요일 — []=수업 전 요일 등원, ['mon','thu']=월·목만. */
  attendanceDays: string[];
};

export type ClassAttendanceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** PostgREST .or()/ilike 안전화 — 구분자·와일드카드 제거(한글/공백 보존). search/queries.ts와 동일. */
function sanitizeTerm(q: string): string {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

/** class_schedules 행들 → classId별 (요일→최초 시작시각) 맵. */
function buildDaySlots(
  scheds: { class_id: string; day_of_week: string; start_time?: string | null }[] | null,
): Map<string, Map<string, string | null>> {
  const byClass = new Map<string, Map<string, string | null>>();
  for (const s of scheds ?? []) {
    const m = byClass.get(s.class_id) ?? new Map<string, string | null>();
    const start = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = m.get(s.day_of_week);
    if (prev === undefined) m.set(s.day_of_week, start);
    else if (start !== null && (prev === null || start < prev)) m.set(s.day_of_week, start);
    byClass.set(s.class_id, m);
  }
  return byClass;
}

/** (요일→시작시각) 맵 → 요일순 정렬된 ClassDaySlot[]. */
function sortedDaySlots(m: Map<string, string | null> | undefined): ClassDaySlot[] {
  return [...(m?.entries() ?? [])]
    .sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0]))
    .map(([day, start]) => ({ day, start }));
}

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

  // 요일 + 시작시각
  let daysByClass = new Map<string, Map<string, string | null>>();
  if (classIds.length > 0) {
    const { data: scheds } = await supabase
      .from("class_schedules")
      .select("class_id, day_of_week, start_time")
      .in("class_id", classIds);
    daysByClass = buildDaySlots(scheds);
  }

  let rows = classes.map((c) => {
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
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      studentCount: counts.get(c.id) ?? 0,
      days: sortedDaySlots(daysByClass.get(c.id)),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  // 요일 필터 (in-memory)
  if (options?.day && options.day !== "all") {
    rows = rows.filter((r) => r.days.some((d) => d.day === options.day));
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

/** 수업목록 정렬 — 수업명(기본)·학생수(많은순)·강사명(가나다, 미정은 끝). 동률은 수업명 보조정렬. */
function sortClassRows(rows: ClassListRow[], sort: ClassSort): void {
  const byName = (a: ClassListRow, b: ClassListRow) => a.className.localeCompare(b.className, "ko");
  rows.sort((a, b) => {
    if (sort === "students") return b.studentCount - a.studentCount || byName(a, b);
    if (sort === "teacher")
      return (a.teacherName ?? "힣").localeCompare(b.teacherName ?? "힣", "ko") || byName(a, b);
    return byName(a, b);
  });
}

/**
 * 수업목록 — 모집단이 작아(학원 단위 수업 ~수백) 매칭 전건을 가져와 메모리에서 정렬·페이지네이션한다.
 * 학생수·강사명 정렬은 파생/조인 필드라 PostgREST 부모행 order로 표현 불가 → 전건 후 메모리 정렬이 정답.
 * subject/teacher/q는 SQL, 요일(다중)은 class_schedules에서 "선택 요일 중 하나라도" 가진 수업 id로 먼저 좁힌다.
 * 학생수·요일 enrich는 매칭 수업 id를 청크로 조회(414/1000행 절단 회피, lib/supabase/batch).
 */
export async function getClassesPage(
  options: ClassListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: ClassListRow[]; total: number }> {
  const supabase = await createClient();
  const sort: ClassSort = options.sort ?? "name";

  // 요일(다중) 필터 — 선택 요일 중 하나라도 운영하는 수업 id로 좁힘(ijw "하나라도 포함" 의미).
  let dayClassIds: string[] | null = null;
  const days = (options.days ?? []).filter(Boolean);
  if (days.length > 0) {
    const { data: scheds, error } = await supabase
      .from("class_schedules")
      .select("class_id")
      .in("day_of_week", days);
    if (error) throw new Error(`getClassesPage(days): ${error.message}`);
    dayClassIds = [...new Set((scheds ?? []).map((s) => s.class_id))];
    if (dayClassIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");
  if (options.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (options.teacherId && options.teacherId !== "all") qb = qb.eq("teacher_id", options.teacherId);
  if (options.active === "active") qb = qb.eq("is_active", true);
  if (options.active === "closed") qb = qb.eq("is_active", false);
  if (options.q) {
    const term = sanitizeTerm(options.q);
    if (term) {
      // 반이름 OR 강사명: 강사명에 매칭되는 강사 id를 먼저 풀어 teacher_id로 좁힌다(null 강사 안전).
      const { data: matchTeachers } = await supabase
        .from("users")
        .select("id")
        .ilike("display_name", `%${term}%`);
      const teacherIds = (matchTeachers ?? []).map((u) => u.id);
      const orParts = [`class_name.ilike.%${term}%`];
      if (teacherIds.length) orParts.push(`teacher_id.in.(${teacherIds.join(",")})`);
      qb = qb.or(orParts.join(","));
    }
  }
  if (dayClassIds) qb = qb.in("id", dayClassIds);

  const { data: classes, error } = await qb;
  if (error) throw new Error(`getClassesPage: ${error.message}`);
  const matched = classes ?? [];
  const classIds = matched.map((c) => c.id);

  // 학생수·요일 — 매칭 수업 id를 청크로 조회(전건 .in() 414/1000행 절단 회피).
  const counts = new Map<string, number>();
  let daysByClass = new Map<string, Map<string, string | null>>();
  if (classIds.length > 0) {
    const [enrollments, scheds] = await Promise.all([
      fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
        supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", chunk),
      ),
      fetchInChunks<{ class_id: string; day_of_week: string; start_time: string | null }>(
        classIds,
        (chunk) =>
          supabase
            .from("class_schedules")
            .select("class_id, day_of_week, start_time")
            .in("class_id", chunk),
      ),
    ]);
    for (const e of enrollments) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    daysByClass = buildDaySlots(scheds);
  }

  const rows = matched.map((c) => {
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
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      studentCount: counts.get(c.id) ?? 0,
      days: sortedDaySlots(daysByClass.get(c.id)),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  sortClassRows(rows, sort);

  const total = rows.length;
  const from = (page - 1) * pageSize;
  return { rows: rows.slice(from, from + pageSize), total };
}

export async function getClassTeacherOptions(): Promise<
  { id: string; name: string; subjects: string[] }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role, subjects")
    .in("system_role", ["teacher", "manager", "master"])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.display_name,
    subjects: u.subjects ?? [],
  }));
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
    .select("id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id")
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
      teacherId: (s.teacher_id as string | null) ?? null,
      classroomId: (s.classroom_id as string | null) ?? null,
    })),
    studentCount: studentCount ?? 0,
  };
}

export async function getClassStudents(classId: string): Promise<ClassStudentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, on_hold, attendance_days,
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
        attendanceDays: (e.attendance_days as string[] | null) ?? [],
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
