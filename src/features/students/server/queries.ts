import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { attendanceRate } from "@/lib/calc/attendance";

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
  // 학생 전건을 .range()로 페이지네이션 — export·반 상세가 전 학생을 받으므로 1000행 절단 방지.
  const data = await fetchAllPaged((from, to) => {
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
    return qb.range(from, to);
  });
  if (data.length === 0) return [];

  // 학생별 수강 과목 unique (active enrollments). id를 청크로 .in()(414 + error삼킴 방지).
  const studentIds = data.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  {
    const ens = await fetchInChunks<{
      student_id: string;
      on_hold: boolean;
      end_date: string | null;
      class: { subject?: string } | { subject?: string }[] | null;
    }>(studentIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("student_id, on_hold, end_date, class:class_id ( subject )")
        .in("student_id", chunk)
        .is("end_date", null),
    );

    for (const e of ens) {
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

/**
 * Stat 표시용 상태별 카운트 — SQL `count(exact, head)` 4개 병렬. 전건 row를 끌어와 JS로 세던 것을
 * 교체(#P2: docstring은 "전체 fetch 회피"였지만 구현은 정반대였고, 1000행 초과 시 무음 과소집계).
 */
export async function getStudentStatusCounts(): Promise<{
  all: number;
  enrolled: number;
  prospect: number;
  withdrawn: number;
}> {
  const supabase = await createClient();
  const base = () => supabase.from("students").select("*", { count: "exact", head: true });
  const [all, enrolled, prospect, withdrawn] = await Promise.all([
    base(),
    base().eq("status", "enrolled"),
    base().in("status", ["prospect", "consulted"]),
    base().eq("status", "withdrawn"),
  ]);
  return {
    all: all.count ?? 0,
    enrolled: enrolled.count ?? 0,
    prospect: prospect.count ?? 0,
    withdrawn: withdrawn.count ?? 0,
  };
}

/**
 * 학생목록 페이지용 서버 페이지네이션. 전체 564명을 통째로 가져와 렌더하던 병목 해소
 * (페이지 50행 + 그 페이지 학생의 enrollments만 조회). 과목 필터는 해당 과목 active 수강 학생
 * id를 먼저 풀어 `.in()`으로 좁힌다(in-memory 전체 필터 회피).
 */
export async function getStudentsPage(
  options: StudentListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: StudentListRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let subjectIds: string[] | null = null;
  if (options?.subject && options.subject !== "all") {
    const { data: ens } = await supabase
      .from("enrollments")
      .select("student_id, class:class_id!inner ( subject )")
      .eq("class.subject", options.subject)
      .is("end_date", null)
      .eq("on_hold", false);
    subjectIds = [...new Set((ens ?? []).map((e) => e.student_id))];
    if (subjectIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("students")
    .select(
      `id, name, school, grade, status, enrolled_at, parent_phone,
       teacher:primary_teacher_id ( display_name )`,
      { count: "exact" },
    )
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);
  if (options?.q) {
    const term = options.q.trim();
    // 이름·학교 외 전화(학생/보호자)·보호자명까지 — 데스크 응대 시 전화로 학생 찾기 빈번.
    if (term) {
      const esc = term.replace(/[,()]/g, " ");
      qb = qb.or(
        `name.ilike.%${esc}%,school.ilike.%${esc}%,student_phone.ilike.%${esc}%,parent_phone.ilike.%${esc}%,parent_name.ilike.%${esc}%`,
      );
    }
  }
  if (subjectIds) qb = qb.in("id", subjectIds);
  qb = qb.range(from, to);

  const { data, count } = await qb;
  const pageData = data ?? [];

  const ids = pageData.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  if (ids.length > 0) {
    const { data: ens } = await supabase
      .from("enrollments")
      .select("student_id, on_hold, end_date, class:class_id ( subject )")
      .in("student_id", ids)
      .is("end_date", null);
    for (const e of ens ?? []) {
      if (e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as { subject?: string } | undefined;
      if (!klass?.subject) continue;
      const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
      set.add(klass.subject);
      subjectsByStudent.set(e.student_id, set);
    }
  }

  const rows = pageData.map((r) => {
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

  return { rows, total: count ?? rows.length };
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
    rate: attendanceRate(present, total),
  };
}

// ────────────────────── 7탭 데이터 ──────────────────────

export type StudentBillingRow = {
  id: string;
  period: string;
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
};

export async function getStudentInvoices(studentId: string): Promise<StudentBillingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, period, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes",
    )
    .eq("student_id", studentId)
    .order("period", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    period: r.period,
    amountTotal: Number(r.amount_total),
    amountPaid: Number(r.amount_paid),
    amountDiscount: Number(r.amount_discount),
    status: r.status,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    notes: r.notes,
  }));
}

export type StudentGradeRow = {
  id: string;
  examName: string;
  subject: string;
  score: number | null;
  maxScore: number | null;
  takenOn: string;
  notes: string | null;
};

export async function getStudentGrades(studentId: string): Promise<StudentGradeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_grades")
    .select("id, exam_name, subject, score, max_score, taken_on, notes")
    .eq("student_id", studentId)
    .order("taken_on", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    examName: r.exam_name,
    subject: r.subject,
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    takenOn: r.taken_on,
    notes: r.notes,
  }));
}

export type StudentMemoRow = {
  id: string;
  category: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
};

export async function getStudentMemos(studentId: string): Promise<StudentMemoRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_memos")
    .select(
      `id, category, content, pinned, created_at, created_by,
       author:created_by ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const a = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      category: r.category,
      content: r.content,
      pinned: r.pinned ?? false,
      createdAt: r.created_at,
      createdBy: r.created_by,
      createdByName: a?.display_name ?? null,
    };
  });
}

export type StudentConsultationRow = {
  id: string;
  consultedAt: string;
  category: string | null;
  subject: string | null;
  audience: string | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  counselorName: string | null;
};

export async function getStudentConsultationHistory(
  studentId: string,
): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(
      `id, consulted_at, category, subject, audience, summary,
       follow_up_action, follow_up_date, follow_up_done,
       counselor:counselor_id ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("consulted_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      consultedAt: r.consulted_at,
      category: r.category,
      subject: r.subject,
      audience: r.audience,
      summary: r.summary,
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      followUpDone: r.follow_up_done,
      counselorName: c?.display_name ?? null,
    };
  });
}

export type StudentAttendanceDay = {
  date: string;
  status: string;
  className: string;
};

export async function getStudentAttendanceCalendar(
  studentId: string,
  days = 60,
): Promise<StudentAttendanceDay[]> {
  const supabase = await createClient();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const { data } = await supabase
    .from("attendance_records")
    .select(`session_date, status, class:class_id ( class_name )`)
    .eq("student_id", studentId)
    .gte("session_date", start.toISOString().slice(0, 10))
    .order("session_date", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { class_name?: string }
      | undefined;
    return {
      date: r.session_date,
      status: r.status,
      className: c?.class_name ?? "?",
    };
  });
}

// 등록상담 → 학생 timeline ↔ 학생상담 + 메모 + enrollment 변경 통합
export type TimelineEvent = {
  date: string; // ISO date
  kind: "enrollment_start" | "enrollment_end" | "consultation" | "memo" | "status_change" | "grade";
  title: string;
  description?: string | null;
};

export async function getStudentTimeline(studentId: string): Promise<TimelineEvent[]> {
  const supabase = await createClient();

  const [
    { data: enrollments },
    { data: consultations },
    { data: memos },
    { data: grades },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select(`start_date, end_date, withdrawal_reason, class:class_id ( class_name )`)
      .eq("student_id", studentId),
    supabase
      .from("student_consultations")
      .select(`consulted_at, category, summary`)
      .eq("student_id", studentId),
    supabase
      .from("student_memos")
      .select(`created_at, category, content`)
      .eq("student_id", studentId),
    supabase
      .from("student_grades")
      .select(`taken_on, exam_name, subject, score, max_score`)
      .eq("student_id", studentId),
  ]);

  const events: TimelineEvent[] = [];

  for (const e of enrollments ?? []) {
    const c = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string }
      | undefined;
    events.push({
      date: e.start_date,
      kind: "enrollment_start",
      title: `${c?.class_name ?? "—"} 수강 시작`,
    });
    if (e.end_date) {
      events.push({
        date: e.end_date,
        kind: "enrollment_end",
        title: `${c?.class_name ?? "—"} 수강 종료`,
        description: e.withdrawal_reason,
      });
    }
  }

  // category 코드 → 한글. 임포트 데이터엔 audience 값("parent")이 섞여 있어, 매핑 안 되는 코드는 접미사 생략.
  const CONSULT_CATEGORY_LABEL: Record<string, string> = {
    general: "일반",
    academic: "학습/성적",
    emotional: "정서/심리",
    career: "진로",
    social: "교우관계",
    other: "기타",
  };
  for (const c of consultations ?? []) {
    const catLabel = c.category ? CONSULT_CATEGORY_LABEL[c.category] : null;
    events.push({
      date: String(c.consulted_at).slice(0, 10),
      kind: "consultation",
      title: catLabel ? `상담 — ${catLabel}` : "상담",
      description: c.summary,
    });
  }

  for (const m of memos ?? []) {
    events.push({
      date: String(m.created_at).slice(0, 10),
      kind: "memo",
      title: `메모 — ${m.category}`,
      description: m.content,
    });
  }

  for (const g of grades ?? []) {
    events.push({
      date: g.taken_on,
      kind: "grade",
      title: `${g.subject} — ${g.exam_name}`,
      description:
        g.score == null
          ? null
          : g.max_score
            ? `${g.score} / ${g.max_score}점`
            : `${g.score}점`,
    });
  }

  // 최신 → 과거 정렬
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}

// ────────────────────── QuickPanel 경량 요약 ──────────────────────

export type StudentSummary = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  primaryTeacherName: string | null;
  attendance: {
    rate: number;
    total: number;
    present: number;
    absent: number;
    late: number;
  };
  enrollments: { className: string; subject: string; onHold: boolean }[];
  billing: {
    unpaidCount: number;
    overdueCount: number;
    latestPeriod: string | null;
    latestStatus: string | null;
  };
};

/**
 * 학생 QuickPanel(우측 오버레이)용 경량 요약. 기존 server-only 쿼리들을
 * Promise.all로 합쳐 한 번에 반환. 리스트 로드엔 영향 없고(클릭 시 on-demand),
 * route handler(/api/students/[id]/summary)에서 호출된다.
 */
export async function getStudentSummary(studentId: string): Promise<StudentSummary | null> {
  const [detail, attendance, enrollments, invoices] = await Promise.all([
    getStudentById(studentId),
    getStudentAttendanceStats(studentId, 30),
    getStudentEnrollments(studentId),
    getStudentInvoices(studentId),
  ]);
  if (!detail) return null;

  const today = new Date().toISOString().slice(0, 10);
  const unpaid = invoices.filter((i) => i.status !== "paid");
  const overdue = unpaid.filter((i) => i.dueDate != null && i.dueDate < today);
  const latest = invoices[0] ?? null; // period desc 정렬이라 [0]이 최신

  return {
    id: detail.id,
    name: detail.name,
    school: detail.school,
    grade: detail.grade,
    status: detail.status,
    primaryTeacherName: detail.primaryTeacherName,
    attendance: {
      rate: attendance.rate,
      total: attendance.total,
      present: attendance.present,
      absent: attendance.absent,
      late: attendance.late,
    },
    enrollments: enrollments
      .filter((e) => e.endDate == null)
      .map((e) => ({ className: e.className, subject: e.subject, onHold: e.onHold })),
    billing: {
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      latestPeriod: latest?.period ?? null,
      latestStatus: latest?.status ?? null,
    },
  };
}
