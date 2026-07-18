import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { attendanceRate } from "@/lib/calc/attendance";
import {
  enrollmentAttendsOnDay,
  isEnrollmentActiveOn,
} from "@/features/enrollments/eligibility";

const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** 일별 출결 처리 현황 — 그 요일 수업 반별 예정 학생수 vs 기록수(미처리 추적·완료율). ijw DailyAttendance 이식. */
export type ClassProcessing = {
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  expected: number; // 활성 enrollment 학생 수(예정)
  recorded: number; // 기록된 학생 수
  unprocessed: number; // 미처리
  rate: number; // 완료율 0~100
};

export async function getDailyProcessingStatus(date: string): Promise<ClassProcessing[]> {
  const supabase = await createClient();
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayEnum = DOW_ENUM[dow];

  // 그 요일에 수업이 있는 반(중복 제거)
  const { data: sched, error: scheduleError } = await supabase
    .from("class_schedules")
    .select("class_id")
    .eq("day_of_week", dayEnum)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  if (scheduleError) throw new Error(`daily attendance schedules: ${scheduleError.message}`);
  const classIds = [...new Set((sched ?? []).map((s) => s.class_id as string))];
  if (classIds.length === 0) return [];

  // 반 메타(활성만) — id 청크로(414 방지)
  const classes = await fetchInChunks<{
    id: string;
    class_name: string;
    subject: string;
    is_active: boolean;
    closed_at: string | null;
    teacher: { display_name?: string } | { display_name?: string }[] | null;
  }>(classIds, (chunk) =>
    supabase
      .from("classes")
      .select("id, class_name, subject, is_active, closed_at, teacher:teacher_id ( display_name )")
      .in("id", chunk)
      .eq("is_active", true),
  );
  const activeClasses = classes.filter((klass) => !klass.closed_at || klass.closed_at >= date);
  const activeClassIds = activeClasses.map((c) => c.id);
  if (activeClassIds.length === 0) return [];

  // 활성 enrollment(예정) + 그 날짜 기록(처리) — 둘 다 id 청크
  const [enrollments, records] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean | null;
      attendance_days: string[] | null;
    }>(
      activeClassIds,
      (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days")
          .in("class_id", chunk)
          .lte("start_date", date)
          .order("id", { ascending: true })
          .range(from, to),
    ),
    fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string }>(activeClassIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, class_id, student_id")
        .eq("session_date", date)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const expectedByClass = new Map<string, Set<string>>();
  for (const e of enrollments) {
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date,
          endDate: e.end_date,
          onHold: e.on_hold,
          isTransferred: e.is_transferred === true,
        },
        date,
      ) ||
      !enrollmentAttendsOnDay(e.attendance_days, dayEnum)
    ) {
      continue;
    }
    (expectedByClass.get(e.class_id) ?? expectedByClass.set(e.class_id, new Set()).get(e.class_id)!).add(e.student_id);
  }
  const recordedByClass = new Map<string, Set<string>>();
  for (const r of records) {
    if (!expectedByClass.get(r.class_id)?.has(r.student_id)) continue;
    (recordedByClass.get(r.class_id) ?? recordedByClass.set(r.class_id, new Set()).get(r.class_id)!).add(r.student_id);
  }

  const rows: ClassProcessing[] = activeClasses.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as { display_name?: string } | undefined;
    const expected = expectedByClass.get(c.id)?.size ?? 0;
    const recorded = recordedByClass.get(c.id)?.size ?? 0;
    return {
      classId: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherName: teacher?.display_name ?? null,
      expected,
      recorded,
      unprocessed: Math.max(0, expected - recorded),
      rate: expected > 0 ? Math.round((Math.min(recorded, expected) / expected) * 100) : 100,
    };
  });
  // 미처리 많은 반 먼저(운영 우선순위), 동률이면 반명.
  rows.sort((a, b) => b.unprocessed - a.unprocessed || a.className.localeCompare(b.className, "ko"));
  return rows;
}

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
  // 시수(정규 1회 기준 배수, 0115a). null=기본 1.
  sessionUnits: number | null;
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
      sessionUnits: number | null;
    }
  >();
  if (studentIds.length > 0) {
    const { data: records } = await supabase
      .from("attendance_records")
      .select("id, student_id, status, note, homework_required, homework_done, session_units, recorded_at")
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
          sessionUnits: r.session_units === null ? null : Number(r.session_units),
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
        sessionUnits: existing?.sessionUnits ?? null,
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
  date: string; // "2026-05-01" (placeholder면 "pad-29" 등 합성 키)
  day: number; // 1~31
  dow: number; // 0=일, 6=토 (placeholder면 -1)
  label: string; // "일/월/화/.../토" (placeholder면 "")
  isWeekend: boolean;
  isToday: boolean;
  // 그 달에 없는 날(예 28일 달의 29~31) — 항상 31칸을 렌더해 출석률 위치를 고정하기 위한 빈 여백.
  placeholder?: boolean;
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
    // 담임 재직 여부 — 퇴직(inactive) 담임 반은 살아있는 한 노출하되, 강사 필터에 "(퇴직)" 표시.
    teacherActive: boolean;
  }[];
  selectedClassId: string | null;
  month: string; // "2026-05"
  days: MatrixDay[];
  students: MatrixStudent[];
  // studentId → date → status
  marks: Record<string, Record<string, AttendanceStatus>>;
  // studentId → date → note (사유) — 매트릭스 인디케이터/툴팁용
  notes: Record<string, Record<string, string>>;
  // studentId → date → 시수(배수, 0115a). 기록이 없거나 기본(1)이면 키 없음 — 셀 표시·시수 합계용.
  units: Record<string, Record<string, number>>;
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
  const todayIso = kstToday();
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
  requestedClassId: string | null,
): Promise<AttendanceMatrix> {
  const supabase = await createClient();

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 selector·데이터를 본인 담당 반만(URL로 남의 classId 넘겨도 무시).
  const tId = await effectiveTeacherId();

  // 활성 반만 (selector용) — 폐강 반 제외(getDailyProcessingStatus와 동일 기준). 강사면 본인 담당 반만.
  // ⚠️ 담임이 퇴직(status=inactive)이어도 반이 살아있으면 노출 유지 — 재원생이 다니는 반을 숨기면 안 됨.
  //    대신 teacherActive로 내려 강사 필터에 "(퇴직)"을 표시한다(담임 재배정 전까지의 정직한 표시).
  let classesQuery = supabase
    .from("classes")
    .select("id, class_name, subject, teacher:teacher_id ( id, display_name, status )")
    .eq("is_active", true)
    .order("class_name");
  if (tId) classesQuery = classesQuery.eq("teacher_id", tId);
  const { data: classesData } = await classesQuery;

  const classes = (classesData ?? []).map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { id?: string; display_name?: string; status?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.display_name ?? null,
      teacherActive: teacher ? teacher.status !== "inactive" : true,
    };
  });

  // 강사가 본인 반이 아닌 classId를 URL로 넘기면 선택 무시(스코프 위반 차단).
  const classId = tId && requestedClassId && !classes.some((c) => c.id === requestedClassId)
    ? null
    : requestedClassId;

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
      units: {},
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
  const units: Record<string, Record<string, number>> = {};
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let makeupCount = 0;
  let totalRecords = 0;

  if (studentIds.length > 0) {
    const { data: records } = await supabase
      .from("attendance_records")
      .select("student_id, session_date, status, note, session_units, recorded_at")
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
      // 시수(배수) — null=기본 1이라 저장 안 함(키 없음 = 1). numeric은 문자열로 올 수 있어 Number 변환.
      const u = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
      if (u !== null && Number.isFinite(u) && u !== 1) {
        units[r.student_id] ??= {};
        units[r.student_id]![r.session_date] = u;
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
    units,
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
  // B2: 소비처(AI 비서 출결 집계 등)가 length·byStatus로 센다 — 하루 기록이 1000행을 넘으면
  // 무페이징 select는 silent 절단, `!data` 폴백은 에러까지 삼킨다 → fetchAllPaged(throw)로 전건.
  const data = await fetchAllPaged((from, to) =>
    supabase
      .from("attendance_records")
      .select(
        `id, status,
         student:student_id ( id, name, grade ),
         class:class_id ( id, class_name, subject )`,
      )
      .eq("session_date", date)
      // OFFSET 페이지 안정화 — unique tie-break(id) 포함 order(batch.ts 계약)
      .order("class_id")
      .order("id")
      .range(from, to),
  );

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
