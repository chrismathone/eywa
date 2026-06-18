import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attendanceRate } from "@/lib/calc/attendance";

export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "excused"
  | "makeup"
  | "early_leave";

export type AttendanceRow = {
  id: string;
  status: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  classId: string;
  className: string;
  subject: string;
};

export type ClassMeta = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

export type AttendanceInputRow = {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  enrollmentId: string;
  existingRecordId: string | null;
  status: AttendanceStatus | null;
  note: string | null;
  homeworkRequired: boolean;
  homeworkDone: boolean;
};

export async function getClassMeta(classId: string): Promise<ClassMeta | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select("id, class_name, subject, teacher:teacher_id ( display_name )")
    .eq("id", classId)
    .single();
  if (!data) return null;
  const teacher = (Array.isArray(data.teacher) ? data.teacher[0] : data.teacher) as
    | { display_name?: string }
    | undefined;
  return {
    id: data.id,
    className: data.class_name,
    subject: data.subject,
    teacherName: teacher?.display_name ?? null,
  };
}

/** Active enrollments + their current attendance record for one (class, date). */
export async function getAttendanceInputRows(
  classId: string,
  date: string,
): Promise<AttendanceInputRow[]> {
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold,
       student:student_id ( id, name, grade )`,
    )
    .eq("class_id", classId)
    .lte("start_date", date);

  const active = (enrollments ?? []).filter(
    (e) => !e.on_hold && (!e.end_date || e.end_date >= date),
  );

  const studentIds = active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string }
        | undefined;
      return s?.id;
    })
    .filter((id): id is string => !!id);

  let recordMap = new Map<
    string,
    {
      id: string;
      status: AttendanceStatus;
      note: string | null;
      homeworkRequired: boolean;
      homeworkDone: boolean;
    }
  >();
  if (studentIds.length > 0) {
    const { data: records } = await supabase
      .from("attendance_records")
      .select("id, student_id, status, note, homework_required, homework_done, recorded_at")
      .eq("class_id", classId)
      .eq("session_date", date)
      .in("student_id", studentIds)
      .order("recorded_at", { ascending: false });

    // Keep the latest record per student (records are sorted desc by recorded_at)
    recordMap = new Map();
    for (const r of records ?? []) {
      if (!recordMap.has(r.student_id)) {
        recordMap.set(r.student_id, {
          id: r.id,
          status: r.status as AttendanceStatus,
          note: r.note,
          homeworkRequired: r.homework_required,
          homeworkDone: r.homework_done,
        });
      }
    }
  }

  return active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null }
        | undefined;
      if (!s) return null;
      const existing = recordMap.get(s.id);
      return {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        enrollmentId: e.id,
        existingRecordId: existing?.id ?? null,
        status: existing?.status ?? null,
        note: existing?.note ?? null,
        homeworkRequired: existing?.homeworkRequired ?? false,
        homeworkDone: existing?.homeworkDone ?? false,
      } satisfies AttendanceInputRow;
    })
    .filter((r): r is AttendanceInputRow => r !== null)
    .sort((a, b) => {
      const ga = a.studentGrade ?? "";
      const gb = b.studentGrade ?? "";
      if (ga !== gb) return ga.localeCompare(gb, "ko");
      return a.studentName.localeCompare(b.studentName, "ko");
    });
}

export async function getMostRecentAttendanceDate(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("session_date")
    .order("session_date", { ascending: false })
    .limit(1);
  return data?.[0]?.session_date ?? null;
}

// ─────────────────── ijw 스타일 월 매트릭스 ───────────────────

export type MatrixDay = {
  date: string; // "2026-05-01"
  day: number; // 1~31
  dow: number; // 0=일, 6=토
  label: string; // "일/월/화/.../토"
  isWeekend: boolean;
  isToday: boolean;
};

export type MatrixStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: string | null;
};

export type AttendanceMatrix = {
  classes: {
    id: string;
    className: string;
    subject: string;
    teacherId: string | null;
    teacherName: string | null;
  }[];
  selectedClassId: string | null;
  month: string; // "2026-05"
  days: MatrixDay[];
  students: MatrixStudent[];
  // studentId → date → status
  marks: Record<string, Record<string, AttendanceStatus>>;
  // studentId → date → note (사유) — 매트릭스 인디케이터/툴팁용
  notes: Record<string, Record<string, string>>;
  stats: {
    totalStudents: number;
    presentRate: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    makeupCount: number;
    totalRecords: number;
  };
};

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function buildMonthDays(month: string): MatrixDay[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const lastDay = new Date(y, m, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);
  const days: MatrixDay[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(y, m - 1, d).getDay();
    days.push({
      date: dateStr,
      day: d,
      dow,
      label: DOW_LABEL[dow] ?? "?",
      isWeekend: dow === 0 || dow === 6,
      isToday: dateStr === todayIso,
    });
  }
  return days;
}

/**
 * 한 반의 한 달치 모든 학생 출석 — 매트릭스 형태로.
 * classId 없으면 모든 반의 통계만 반환 (학생 없음).
 */
export async function getMonthlyAttendanceMatrix(
  month: string,
  classId: string | null,
): Promise<AttendanceMatrix> {
  const supabase = await createClient();

  // 모든 반 (selector용)
  const { data: classesData } = await supabase
    .from("classes")
    .select("id, class_name, subject, teacher:teacher_id ( id, display_name )")
    .order("class_name");

  const classes = (classesData ?? []).map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { id?: string; display_name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.display_name ?? null,
    };
  });

  const days = buildMonthDays(month);
  if (!classId || days.length === 0) {
    return {
      classes,
      selectedClassId: classId,
      month,
      days,
      students: [],
      marks: {},
      notes: {},
      stats: {
        totalStudents: 0,
        presentRate: 0,
        presentCount: 0,
        absentCount: 0,
        lateCount: 0,
        makeupCount: 0,
        totalRecords: 0,
      },
    };
  }

  const startIso = days[0]!.date;
  const endIso = days[days.length - 1]!.date;

  // 해당 반의 활성 학생 (해당 월 종료일 기준)
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold,
       student:student_id ( id, name, grade, school )`,
    )
    .eq("class_id", classId)
    .lte("start_date", endIso);

  const studentMap = new Map<string, MatrixStudent>();
  for (const e of enrollments ?? []) {
    if (e.on_hold) continue;
    if (e.end_date && e.end_date < startIso) continue;
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
      | { id: string; name: string; grade: string | null; school: string | null }
      | undefined;
    if (!s) continue;
    if (!studentMap.has(s.id)) {
      studentMap.set(s.id, {
        id: s.id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
      });
    }
  }
  const students = Array.from(studentMap.values()).sort((a, b) => {
    const ga = a.grade ?? "";
    const gb = b.grade ?? "";
    if (ga !== gb) return ga.localeCompare(gb, "ko");
    return a.name.localeCompare(b.name, "ko");
  });

  // 해당 월의 모든 출결 기록 (반 + 학생 + 기간)
  const studentIds = students.map((s) => s.id);
  const marks: Record<string, Record<string, AttendanceStatus>> = {};
  const notes: Record<string, Record<string, string>> = {};
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let makeupCount = 0;
  let totalRecords = 0;

  if (studentIds.length > 0) {
    const { data: records } = await supabase
      .from("attendance_records")
      .select("student_id, session_date, status, note, recorded_at")
      .eq("class_id", classId)
      .in("student_id", studentIds)
      .gte("session_date", startIso)
      .lte("session_date", endIso)
      .order("recorded_at", { ascending: false });

    // 같은 (student, date) 중 최신 record만 채택
    const seen = new Set<string>();
    for (const r of records ?? []) {
      const k = `${r.student_id}::${r.session_date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const status = r.status as AttendanceStatus;
      marks[r.student_id] ??= {};
      marks[r.student_id]![r.session_date] = status;
      if (r.note) {
        notes[r.student_id] ??= {};
        notes[r.student_id]![r.session_date] = r.note as string;
      }
      totalRecords++;
      if (status === "present") presentCount++;
      else if (status === "absent") absentCount++;
      else if (status === "late") lateCount++;
      else if (status === "makeup") makeupCount++;
    }
  }

  const presentRate =
    totalRecords > 0 ? Math.round(attendanceRate(presentCount, totalRecords) * 10) / 10 : 0;

  return {
    classes,
    selectedClassId: classId,
    month,
    days,
    students,
    marks,
    notes,
    stats: {
      totalStudents: students.length,
      presentRate,
      presentCount,
      absentCount,
      lateCount,
      makeupCount,
      totalRecords,
    },
  };
}

export async function getAttendanceForDate(date: string): Promise<AttendanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select(
      `id, status,
       student:student_id ( id, name, grade ),
       class:class_id ( id, class_name, subject )`,
    )
    .eq("session_date", date)
    .order("class_id");

  if (!data) return [];

  return data.map((r) => {
    const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string; grade: string | null }
      | undefined;
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id: string; class_name: string; subject: string }
      | undefined;
    return {
      id: r.id,
      status: r.status,
      studentId: student?.id ?? "",
      studentName: student?.name ?? "?",
      studentGrade: student?.grade ?? null,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
    };
  });
}
