import "server-only";
import { createClient } from "@/lib/supabase/server";
import { inclusiveDateWindowStart, kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { getUnassignedEnrolledStudents } from "./queries";
import {
  enrollmentAttendsOnDay,
  findStudentsMissingLessonReports,
  isEnrollmentActiveOn,
  type TodayActionsRaw,
  type TodaySignalSourceIssue,
} from "../today-actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type TodayAttendanceRow = EffectiveAttendanceRecord & {
  status: string;
  student: { name?: string } | { name?: string }[] | null;
};

export type TodayActionSignalScope = {
  attendance?: boolean;
  meetings?: boolean;
  enrollment?: boolean;
  consultations?: boolean;
  lessonReports?: boolean;
  /** 반 미배정 학생 확인 및 반 배정 조치(write) */
  students?: boolean;
  billing?: boolean;
  /** 오늘 휴가 현황(read) */
  staff?: boolean;
  /** 휴가 승인 대기(manage-staff). 생략하면 staff와 같아 기존 호출을 보존한다. */
  staffApprovals?: boolean;
  owner?: boolean;
};

type Collected<T> = { value: T; issue: TodaySignalSourceIssue | null };

/** 권한이 없으면 쿼리 자체를 건너뛰고, 예상 가능한 조회 실패는 0건 대신 명시적 상태로 돌려준다. */
async function collectSignal<T>(
  enabled: boolean,
  issue: TodaySignalSourceIssue,
  fallback: T,
  load: () => Promise<T>,
): Promise<Collected<T>> {
  if (!enabled) return { value: fallback, issue: null };
  try {
    return { value: await load(), issue: null };
  } catch (error) {
    console.error(`[dashboard/action-signals] ${issue.key} 조회 실패`, error);
    return { value: fallback, issue };
  }
}

function rowsOrThrow<T>(
  result: { data: T[] | null; error: { message: string } | null },
  source: string,
): T[] {
  if (result.error) throw new Error(`${source}: ${result.error.message}`);
  return result.data ?? [];
}

function countOrThrow(
  result: { count: number | null; error: { message: string } | null },
  source: string,
): number {
  if (result.error) throw new Error(`${source}: ${result.error.message}`);
  if (result.count == null) throw new Error(`${source}: exact count가 없습니다`);
  return result.count;
}

type ScheduleRow = {
  class_id: string;
  start_time: string;
  class:
    | { subject?: string; closed_at?: string | null }
    | { subject?: string; closed_at?: string | null }[]
    | null;
};

type ClassScheduleRow = {
  class_id: string;
  class:
    | { id?: string; class_name?: string; closed_at?: string | null }
    | { id?: string; class_name?: string; closed_at?: string | null }[]
    | null;
};

/** 어제 출결 미기록 — 모든 쿼리 오류를 위로 올려 0개 반과 구분한다. */
async function unrecordedClassesSignal(
  supabase: Supabase,
  date: string,
): Promise<TodayActionsRaw["unrecordedYesterday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await supabase
    .from("class_schedules")
    .select("class_id, class:class_id!inner ( id, class_name, is_active, closed_at )")
    .eq("day_of_week", dayKey)
    .eq("class.is_active", true)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  const scheduleRows = rowsOrThrow(scheduleResult, "yesterday schedules") as unknown as ClassScheduleRow[];
  const classNames = new Map<string, string>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    if (!klass?.id || (klass.closed_at && klass.closed_at < date)) continue;
    classNames.set(row.class_id, klass.class_name ?? "?");
  }
  const classIds = [...classNames.keys()];
  if (classIds.length === 0) return [];

  const [enrollmentRows, attendanceRows] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean;
      attendance_days: string[] | null;
    }>(classIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("id, student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
        .lte("start_date", date)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string }>(classIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, student_id, class_id")
        .eq("session_date", date)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const expectedByClass = new Map<string, Set<string>>();
  for (const row of enrollmentRows) {
    if (
      !isEnrollmentActiveOn(
        {
          startDate: row.start_date,
          endDate: row.end_date,
          onHold: row.on_hold,
          isTransferred: row.is_transferred,
        },
        date,
      ) || !enrollmentAttendsOnDay(row.attendance_days, dayKey)
    ) {
      continue;
    }
    const students = expectedByClass.get(row.class_id) ?? new Set<string>();
    students.add(row.student_id);
    expectedByClass.set(row.class_id, students);
  }
  const recordedByClass = new Map<string, Set<string>>();
  for (const row of attendanceRows) {
    const students = recordedByClass.get(row.class_id) ?? new Set<string>();
    students.add(row.student_id);
    recordedByClass.set(row.class_id, students);
  }

  return classIds.flatMap((classId) => {
    const expected = expectedByClass.get(classId) ?? new Set<string>();
    const recorded = recordedByClass.get(classId) ?? new Set<string>();
    const hasUnrecordedStudent = [...expected].some((studentId) => !recorded.has(studentId));
    return hasUnrecordedStudent
      ? [{ classId, className: classNames.get(classId) ?? "?" }]
      : [];
  }).sort((a, b) => a.className.localeCompare(b.className, "ko"));
}

/**
 * 오늘 미작성 보고서 신호.
 * 시작된 활성 수업의 기준일 유효 수강생을 학생×과목으로 만들고, 그 과목 반이 전부 결석인 학생은 제외한다.
 * lesson_reports에는 class_id가 없으므로 같은 과목 여러 반은 한 대상으로 합친다.
 */
async function unwrittenReportsSignal(
  supabase: Supabase,
  today: string,
): Promise<TodayActionsRaw["unwrittenReportsToday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await supabase
    .from("class_schedules")
    .select(
      `class_id, start_time,
       class:class_id!inner ( subject, is_active, closed_at )`,
    )
    .eq("day_of_week", dayKey)
    .eq("class.is_active", true)
    .lte("valid_from", today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("start_time");
  const scheduleRows = rowsOrThrow(scheduleResult, "lesson report schedules") as unknown as ScheduleRow[];
  const nowMinutes = kstMinutesOfDay();
  const subjectByClass = new Map<string, string>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    if (!klass?.subject || (klass.closed_at && klass.closed_at < today)) continue;
    const [hour, minute] = row.start_time.slice(0, 5).split(":").map(Number);
    const startMinutes = (hour ?? Number.NaN) * 60 + (minute ?? Number.NaN);
    if (!Number.isFinite(startMinutes) || nowMinutes < startMinutes) continue;
    subjectByClass.set(row.class_id, klass.subject);
  }

  const classIds = [...subjectByClass.keys()];
  if (classIds.length === 0) return { count: 0, names: [] };

  const enrollmentRows = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
    attendance_days: string[] | null;
  }>(classIds, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .lte("start_date", today)
      .in("class_id", chunk),
  );
  const targets = enrollmentRows
    .filter(
      (row) =>
        isEnrollmentActiveOn(
          {
            startDate: row.start_date,
            endDate: row.end_date,
            onHold: row.on_hold,
            isTransferred: row.is_transferred,
          },
          today,
        ) && enrollmentAttendsOnDay(row.attendance_days, dayKey),
    )
    .map((row) => ({
      studentId: row.student_id,
      classId: row.class_id,
      subject: subjectByClass.get(row.class_id)!,
    }));
  const studentIds = [...new Set(targets.map((target) => target.studentId))];
  if (studentIds.length === 0) return { count: 0, names: [] };

  const [attendanceRows, reportRows] = await Promise.all([
    fetchInChunks<{ id: string; student_id: string; class_id: string; status: string; recorded_at: string }>(
      studentIds,
      (chunk) =>
        supabase
          .from("attendance_records")
          .select("id, student_id, class_id, status, recorded_at")
          .eq("session_date", today)
          .in("student_id", chunk)
          .order("recorded_at", { ascending: false })
          .order("id", { ascending: false }),
    ),
    fetchInChunks<{ student_id: string; subject: string | null }>(studentIds, (chunk) =>
      supabase
        .from("lesson_reports")
        .select("student_id, subject")
        .eq("report_date", today)
        .in("student_id", chunk),
    ),
  ]);

  // 중복 출결은 최신 기록만 채택한다. 다른 반의 결석은 이 수업 대상 판정에 영향을 주지 않는다.
  const latestAttendance = new Map<string, string>();
  for (const row of attendanceRows) {
    if (!subjectByClass.has(row.class_id)) continue;
    const key = `${row.student_id}::${row.class_id}`;
    if (!latestAttendance.has(key)) latestAttendance.set(key, row.status);
  }
  const absentClassKeys = new Set(
    [...latestAttendance].filter(([, status]) => status === "absent").map(([key]) => key),
  );
  const missingStudentIds = findStudentsMissingLessonReports(
    targets,
    absentClassKeys,
    reportRows.map((row) => ({ studentId: row.student_id, subject: row.subject })),
  );
  if (missingStudentIds.length === 0) return { count: 0, names: [] };

  const studentRows = await fetchInChunks<{ id: string; name: string }>(missingStudentIds.slice(0, 100), (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(studentRows.map((student) => [student.id, student.name]));
  return {
    count: missingStudentIds.length,
    names: missingStudentIds.slice(0, 100).map((id) => nameById.get(id) ?? "(학생)"),
  };
}

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "오늘 조치할 것" 원시 신호 수집. 독립 조회는 병렬로 실행하고, scope=false 도메인은 DB 호출도 하지 않는다.
 * 조회 실패는 해당 도메인의 sourceIssues로 반환해 빈 배열/0건과 구분한다.
 */
export async function getTodayActionSignals(scope: TodayActionSignalScope = {}): Promise<TodayActionsRaw> {
  const supabase = await createClient();
  const today = kstToday();
  const yesterday = daysBefore(today, 1);
  const sevenDayStart = inclusiveDateWindowStart(today, 7);
  const failedCutoff = `${sevenDayStart}T00:00:00+09:00`;
  const enabled = (key: keyof TodayActionSignalScope) => scope[key] !== false;
  const staffApprovalsEnabled = scope.staffApprovals ?? enabled("staff");

  const failedCount = async (
    table: "meeting_minutes" | "enrollment_consultations" | "student_consultations",
  ): Promise<number> => {
    const result = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("processing_status", "failed")
      .gte("updated_at", failedCutoff);
    return countOrThrow(result, table);
  };

  const [
    absent,
    dailyProcessing,
    failedMeetings,
    failedEnrollment,
    failedConsultations,
    makeedu,
    expenses,
    textbooks,
    leavesPending,
    leavesToday,
    unwrittenReports,
    unassignedEnrolled,
  ] = await Promise.all([
    collectSignal(
      enabled("attendance"),
      {
        key: "attendance-today",
        label: "오늘 출결",
        href: "/attendance",
        menuKey: "attendance",
        requiredAccess: "read",
      },
      [] as TodayAttendanceRow[],
      async () => {
        const rows = await fetchAllPaged<TodayAttendanceRow>((from, to) =>
          supabase
            .from("attendance_records")
            .select(
              "id, student_id, class_id, session_date, status, recorded_at, student:student_id ( name )",
            )
            .eq("session_date", today)
            .order("recorded_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );
        return effectiveAttendanceRecords(rows).filter((row) => row.status === "absent");
      },
    ),
    collectSignal(
      enabled("attendance"),
      {
        key: "attendance-yesterday",
        label: "어제 출결 처리",
        href: `/attendance/${yesterday}`,
        menuKey: "attendance",
        requiredAccess: "read",
      },
      [] as TodayActionsRaw["unrecordedYesterday"],
      () => unrecordedClassesSignal(supabase, yesterday),
    ),
    collectSignal(
      enabled("meetings"),
      {
        key: "meeting-analysis",
        label: "회의 분석",
        href: "/meetings",
        menuKey: "meetings",
        requiredAccess: "write",
      },
      0,
      () => failedCount("meeting_minutes"),
    ),
    collectSignal(
      enabled("enrollment"),
      {
        key: "enrollment-analysis",
        label: "등록상담 분석",
        href: "/enrollment",
        menuKey: "enrollment",
        requiredAccess: "write",
      },
      0,
      () => failedCount("enrollment_consultations"),
    ),
    collectSignal(
      enabled("consultations"),
      {
        key: "consultation-analysis",
        label: "학생상담 분석",
        href: "/consultations",
        menuKey: "consultations",
        requiredAccess: "write",
      },
      0,
      () => failedCount("student_consultations"),
    ),
    collectSignal(
      enabled("owner"),
      {
        key: "makeedu-sync",
        label: "makeedu 동기화",
        href: "/owner?tab=sheets",
        menuKey: "owner",
        requiredAccess: "read",
      },
      { syncEnabled: false, rows: [] as { domain: string; status: string; synced_at: string }[] },
      async () => {
        const [stateResult, toggleResult] = await Promise.all([
          supabase.from("makeedu_sync_state").select("domain, status, synced_at"),
          supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu").maybeSingle(),
        ]);
        const rows = rowsOrThrow(stateResult, "makeedu state") as {
          domain: string;
          status: string;
          synced_at: string;
        }[];
        if (toggleResult.error) throw new Error(`makeedu toggle: ${toggleResult.error.message}`);
        return {
          syncEnabled: (toggleResult.data?.sync_enabled as boolean | undefined) ?? true,
          rows,
        };
      },
    ),
    collectSignal(
      enabled("billing"),
      {
        key: "pending-expenses",
        label: "지출 결재",
        href: "/billing?tab=expenses",
        menuKey: "billing",
        requiredAccess: "write",
      },
      0,
      async () => {
        const result = await supabase
          .from("expenses")
          .select("*", { count: "exact", head: true })
          .eq("approval_status", "pending")
          .gte("expense_date", sevenDayStart);
        return countOrThrow(result, "pending expenses");
      },
    ),
    collectSignal(
      enabled("billing"),
      {
        key: "requested-textbooks",
        label: "교재 신청",
        href: "/billing?tab=textbooks&status=requested",
        menuKey: "billing",
        requiredAccess: "write",
      },
      0,
      async () => {
        const result = await supabase
          .from("textbook_orders")
          .select("*", { count: "exact", head: true })
          .eq("status", "requested");
        return countOrThrow(result, "requested textbooks");
      },
    ),
    collectSignal(
      staffApprovalsEnabled,
      {
        key: "pending-leaves",
        label: "휴가 승인",
        href: "/staff/leaves",
        menuKey: "staff",
        requiredAccess: "manage-staff",
      },
      0,
      async () => {
        const result = await supabase
          .from("staff_leaves")
          .select("*", { count: "exact", head: true })
          .is("approved_at", null)
          .gte("ends_on", today);
        return countOrThrow(result, "pending leaves");
      },
    ),
    collectSignal(
      enabled("staff"),
      {
        key: "today-leaves",
        label: "오늘 휴가",
        href: "/staff/leaves",
        menuKey: "staff",
        requiredAccess: "read",
      },
      [] as { user: { display_name?: string } | { display_name?: string }[] | null }[],
      async () => {
        const result = await supabase
          .from("staff_leaves")
          .select("user:user_id ( display_name )")
          .not("approved_at", "is", null)
          .lte("starts_on", today)
          .gte("ends_on", today)
          .limit(20);
        return rowsOrThrow(result, "today approved leaves");
      },
    ),
    collectSignal(
      enabled("lessonReports"),
      {
        key: "lesson-reports",
        label: "수업보고서 작성",
        href: "/lesson-reports?tab=writing",
        menuKey: "lesson_reports",
        requiredAccess: "read",
      },
      { count: 0, names: [] },
      () => unwrittenReportsSignal(supabase, today),
    ),
    collectSignal(
      enabled("students"),
      {
        key: "unassigned-enrolled",
        label: "반 미배정 재원생",
        href: "/students",
        menuKey: "students",
        requiredAccess: "write",
      },
      [] as { studentId: string; name: string }[],
      // students 기준 anti-join RPC(0097a). 등록상담이 아니라 학생이 출처다.
      () => getUnassignedEnrolledStudents(),
    ),
  ]);

  const seen = new Map<string, string>();
  for (const row of absent.value) {
    if (seen.has(row.student_id)) continue;
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) ?? undefined;
    seen.set(row.student_id, student?.name ?? "(학생)");
  }

  let makeeduIssue: TodayActionsRaw["makeeduIssue"] = null;
  if (makeedu.value.syncEnabled && makeedu.value.rows.length > 0) {
    const errors = makeedu.value.rows.filter((row) => row.status !== "ok");
    if (errors.length > 0) {
      makeeduIssue = { kind: "error", detail: `${errors.map((error) => error.domain).join("·")} 실패` };
    } else {
      const latest = Math.max(...makeedu.value.rows.map((row) => Date.parse(row.synced_at)));
      const hours = Math.floor((Date.now() - latest) / 3_600_000);
      if (hours >= 26) makeeduIssue = { kind: "stale", detail: `${hours}시간째 미동기` };
    }
  }

  const collected = [
    absent,
    dailyProcessing,
    failedMeetings,
    failedEnrollment,
    failedConsultations,
    makeedu,
    expenses,
    textbooks,
    leavesPending,
    leavesToday,
    unwrittenReports,
    unassignedEnrolled,
  ];

  return {
    absentToday: [...seen].map(([studentId, name]) => ({ studentId, name })),
    unrecordedYesterday: dailyProcessing.value,
    yesterday,
    failedAnalysis: {
      meetings: failedMeetings.value,
      enrollment: failedEnrollment.value,
      consultations: failedConsultations.value,
    },
    makeeduIssue,
    pendingExpenses: expenses.value,
    requestedTextbooks: textbooks.value,
    leavesPending: leavesPending.value,
    leavesToday: leavesToday.value.map((row) => {
      const user = (Array.isArray(row.user) ? row.user[0] : row.user) ?? undefined;
      return { name: user?.display_name ?? "(직원)" };
    }),
    unwrittenReportsToday: unwrittenReports.value,
    unassignedEnrolled: unassignedEnrolled.value.map((student) => ({
      studentId: student.studentId,
      name: student.name,
    })),
    sourceIssues: collected.flatMap((result) => (result.issue ? [result.issue] : [])),
  };
}
