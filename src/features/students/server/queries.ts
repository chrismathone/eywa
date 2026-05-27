import "server-only";
import { createClient } from "@/lib/supabase/server";

export type StudentListRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  primaryTeacherName: string | null;
  enrolledAt: string | null;
  parentPhone: string | null;
  subjects: string[]; // 수강 중인 과목 unique list
};

export type StudentListFilters = {
  status?: string; // "all" | "enrolled" | "consulted" | "on_hold" | "withdrawn"
  subject?: string; // "all" | "math" | "english" | ...
  q?: string; // 검색어 (이름/학교)
};

export async function getStudentsList(
  options?: StudentListFilters,
): Promise<StudentListRow[]> {
  const supabase = await createClient();
  let qb = supabase
    .from("students")
    .select(
      `id, name, school, grade, status, enrolled_at, parent_phone,
       teacher:primary_teacher_id ( display_name )`,
    )
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);

  // 검색: 이름 또는 학교 부분 매치
  if (options?.q) {
    const term = options.q.trim();
    if (term) qb = qb.or(`name.ilike.%${term}%,school.ilike.%${term}%`);
  }

  const { data } = await qb;
  if (!data) return [];

  // 학생별 수강 과목 unique (active enrollments)
  const studentIds = data.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  if (studentIds.length > 0) {
    const { data: ens } = await supabase
      .from("enrollments")
      .select("student_id, on_hold, end_date, class:class_id ( subject )")
      .in("student_id", studentIds)
      .is("end_date", null);

    for (const e of ens ?? []) {
      if (e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { subject?: string }
        | undefined;
      if (!klass?.subject) continue;
      const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
      set.add(klass.subject);
      subjectsByStudent.set(e.student_id, set);
    }
  }

  let rows = data.map((r) => {
    const teacher = (Array.isArray(r.teacher) ? r.teacher[0] : r.teacher) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      name: r.name,
      school: r.school,
      grade: r.grade,
      status: r.status,
      primaryTeacherName: teacher?.display_name ?? null,
      enrolledAt: r.enrolled_at,
      parentPhone: r.parent_phone,
      subjects: Array.from(subjectsByStudent.get(r.id) ?? []).sort(),
    } satisfies StudentListRow;
  });

  // 과목 필터 (in-memory — subjects가 enrollments에서 옴)
  if (options?.subject && options.subject !== "all") {
    rows = rows.filter((r) => r.subjects.includes(options.subject!));
  }

  return rows;
}

export type CareFocus = {
  priority: "high" | "medium" | "low";
  area: string;
  recommendation: string;
};

export type StudentDetail = {
  id: string;
  name: string;
  studentCode: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  parentName: string | null;
  parentPhone: string | null;
  primaryTeacherId: string | null;
  primaryTeacherName: string | null;
  secondaryTeacherId: string | null;
  secondaryTeacherName: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
  createdAt: string;
  aiCareSummary: string | null;
  aiCareFocus: CareFocus[] | null;
  aiCareModelVersion: string | null;
  aiCareGeneratedAt: string | null;
};

export type TeacherOption = {
  id: string;
  displayName: string;
  systemRole: string;
};

export async function getTeacherOptions(): Promise<TeacherOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role")
    .in("system_role", ["teacher", "counselor", "manager", "admin", "master"])
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    systemRole: r.system_role,
  }));
}

export async function getStudentById(id: string): Promise<StudentDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select(
      `id, name, school, grade, status, student_code,
       enrolled_at, withdrawn_at, created_at, notes,
       parent_name, parent_phone,
       primary_teacher_id, secondary_teacher_id,
       ai_care_summary, ai_care_focus, ai_care_model_version, ai_care_generated_at,
       teacher:primary_teacher_id ( display_name ),
       secondary:secondary_teacher_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  const teacher = (Array.isArray(data.teacher) ? data.teacher[0] : data.teacher) as
    | { display_name?: string }
    | undefined;
  const secondary = (Array.isArray(data.secondary) ? data.secondary[0] : data.secondary) as
    | { display_name?: string }
    | undefined;

  return {
    id: data.id,
    name: data.name,
    studentCode: data.student_code,
    school: data.school,
    grade: data.grade,
    status: data.status,
    primaryTeacherId: data.primary_teacher_id,
    primaryTeacherName: teacher?.display_name ?? null,
    secondaryTeacherId: data.secondary_teacher_id,
    secondaryTeacherName: secondary?.display_name ?? null,
    enrolledAt: data.enrolled_at,
    withdrawnAt: data.withdrawn_at,
    notes: data.notes,
    parentName: data.parent_name,
    parentPhone: data.parent_phone,
    createdAt: data.created_at,
    aiCareSummary: data.ai_care_summary,
    aiCareFocus: Array.isArray(data.ai_care_focus)
      ? (data.ai_care_focus as CareFocus[])
      : null,
    aiCareModelVersion: data.ai_care_model_version,
    aiCareGeneratedAt: data.ai_care_generated_at,
  };
}

export type StudentEnrollment = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
};

export async function getStudentEnrollments(studentId: string): Promise<StudentEnrollment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold,
       class:class_id ( id, class_name, subject )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id?: string; class_name?: string; subject?: string }
      | undefined;
    return {
      id: r.id,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
      startDate: r.start_date,
      endDate: r.end_date,
      onHold: r.on_hold,
    };
  });
}

export type AttendanceWindowStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

export async function getStudentAttendanceStats(
  studentId: string,
  days = 30,
): Promise<AttendanceWindowStats> {
  const supabase = await createClient();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("student_id", studentId)
    .gte("session_date", start.toISOString().slice(0, 10));

  const rows = data ?? [];
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  return {
    total,
    present,
    absent: rows.filter((r) => r.status === "absent").length,
    late: rows.filter((r) => r.status === "late").length,
    excused: rows.filter((r) => r.status === "excused").length,
    rate: total > 0 ? (present / total) * 100 : 0,
  };
}
