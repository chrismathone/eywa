import "server-only";
import { createClient } from "@/lib/supabase/server";
import { inclusiveDateWindowStart, kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { HUMAN_RESOLVED_STATUSES, STUCK_MINUTES } from "@/features/report-admin/classnote-queue";
import { getTenantSettings, getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isReportTrackedSubject } from "../report-subjects";
import { getUnassignedEnrolledStudents } from "./queries";
import {
  enrollmentAttendsOnDay,
  findMissingLessonReportPairs,
  isEnrollmentActiveOn,
  type TodayActionsRaw,
  type TodaySignalSourceIssue,
} from "../today-actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * makeedu 동기화 도메인 키 → 화면 한글 라벨. 원문 enum(invoices·textbook_checks…)을 그대로 노출하지
 * 않기 위한 매핑(raw 코드 노출 금지 규칙). 미등록 키는 키 그대로 폴백(새 도메인이 조용히 사라지지 않게).
 */
const DOMAIN_LABEL: Record<string, string> = {
  students: "학생",
  classes: "수업",
  enrollments: "수강",
  invoices: "수납",
  consultations: "상담",
  prospects: "예비원생",
  catalog: "교재 단가표",
  textbook_checks: "교재 체크",
};

/**
 * **자동 동기화 대상이 아닌** 도메인 — 미동기 경과시간(stale) 판정에서 제외한다.
 *
 * 🔴 2026-07-31 실측: 6개 도메인이 방금(0시간) 동기화됐는데 브리핑이 "makeedu 동기화 이상"을 띄웠다.
 *    범인은 `catalog`(교재 단가표) — [scripts/_makeedu/sync-all.cjs] IMPORTERS에 **의도적으로 없는**
 *    수동 전용 도메인(tuition 기타가 이름 insert라 재실행 시 중복)이다. 수동 도메인의 synced_at은
 *    영원히 낡으므로 26시간 룰에 매일 걸린다 = **영구 오탐**(게다가 AI 팀 보고까지 매일 탈락시켰다).
 *
 * ⚠️ 상태 오류(status<>'ok')는 여전히 잡는다 — 수동이라도 "실행했는데 실패"는 진짜 신호다.
 * ⚠️ sync-all.cjs의 IMPORTERS를 늘리거나 줄이면 여기도 같이 고칠 것(진실은 그쪽 목록).
 */
const MANUAL_ONLY_DOMAINS = new Set(["catalog", "enrollments"]);

/**
 * cron(세션 없음) 주입 계약 — admin client는 RLS를 우회하므로 tenantId 명시 격리가 필수
 * (TimetableDb 선례). 미주입(대시보드 세션 경로)이면 쿠키 createClient + RLS가 격리한다.
 */
export type DashboardSignalsDb = { supabase: Supabase; tenantId: string };
/**
 * 기준 시점 주입 — 아침 cron은 '어제'를 기준일로 신호를 만든다. 시각 게이트(unwrittenReports의
 * "이미 시작한 수업")는 nowMinutes로 결정적: 지나간 날은 1440을 주입하면 전 수업이 대상이 된다.
 */
export type DashboardSignalsAsOf = { date: string; nowMinutes: number };

type TenantScope = { tenantId: string } | undefined;

/** db(admin) 주입 시에만 명시 tenant 필터 부착 — 세션 경로는 RLS가 격리(중복 필터 불필요). */
function scopeTenant<T>(query: T, db: TenantScope): T {
  if (!db) return query;
  return (query as unknown as { eq(column: string, value: unknown): unknown }).eq(
    "tenant_id",
    db.tenantId,
  ) as unknown as T;
}

type TodayAttendanceRow = EffectiveAttendanceRecord & {
  status: string;
  student: { name?: string } | { name?: string }[] | null;
  // 과목별 분해용 — 반이 곧 과목이다(lesson_reports.subject는 채움율이 낮아 못 쓴다).
  class: { subject?: string | null } | { subject?: string | null }[] | null;
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
    | { subject?: string; closed_at?: string | null; report_optout?: boolean | null }
    | { subject?: string; closed_at?: string | null; report_optout?: boolean | null }[]
    | null;
};

type ClassRef = { id?: string; class_name?: string; subject?: string | null; closed_at?: string | null };

type ClassScheduleRow = {
  class_id: string;
  class: ClassRef | ClassRef[] | null;
};

/** 어제 출결 미기록 — 모든 쿼리 오류를 위로 올려 0개 반과 구분한다. */
async function unrecordedClassesSignal(
  supabase: Supabase,
  date: string,
  db?: TenantScope,
): Promise<TodayActionsRaw["unrecordedYesterday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await scopeTenant(
    supabase
      .from("class_schedules")
      // subject는 미리보기 이름 2개를 과목별로 고르게 뽑는 데 쓴다(아래 반환부 주석·gotcha #84).
      .select("class_id, class:class_id!inner ( id, class_name, subject, is_active, closed_at )")
      .eq("day_of_week", dayKey)
      .eq("class.is_active", true)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
    db,
  );
  const scheduleRows = rowsOrThrow(scheduleResult, "yesterday schedules") as unknown as ClassScheduleRow[];
  const classNames = new Map<string, { name: string; subject: string }>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    if (!klass?.id || (klass.closed_at && klass.closed_at < date)) continue;
    classNames.set(row.class_id, { name: klass.class_name ?? "?", subject: klass.subject ?? "" });
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
      scopeTenant(
        supabase
          .from("enrollments")
          .select("id, student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
          .lte("start_date", date)
          .in("class_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
        db,
      ),
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string }>(classIds, (chunk, from, to) =>
      scopeTenant(
        supabase
          .from("attendance_records")
          .select("id, student_id, class_id")
          .eq("session_date", date)
          .in("class_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
        db,
      ),
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

  // ⚠️ 이름순 정렬을 유지하되 subject를 함께 실어 보낸다. 소비처(today-actions)가 미리보기 이름을
  // 2개만 노출하는데, ICU 한국어 정렬은 한글을 로마자보다 앞에 둬서 그냥 앞 2개를 뽑으면 **항상
  // 한글 이름 반(수학)**만 뜨고 영어반은 미기록이 아무리 많아도 '외 N'에 묻힌다(gotcha #84).
  // 그래서 자르는 일은 소비처가 과목별로 고르게 한다 — 여기선 정렬만 하고 카테고리 정보를 넘긴다.
  return classIds.flatMap((classId) => {
    const expected = expectedByClass.get(classId) ?? new Set<string>();
    const recorded = recordedByClass.get(classId) ?? new Set<string>();
    const hasUnrecordedStudent = [...expected].some((studentId) => !recorded.has(studentId));
    const klass = classNames.get(classId);
    return hasUnrecordedStudent
      ? [{ classId, className: klass?.name ?? "?", subject: klass?.subject ?? "" }]
      : [];
  }).sort((a, b) => a.className.localeCompare(b.className, "ko"));
}

/**
 * 오늘 미작성 보고서 신호.
 * 시작된 활성 수업의 기준일 유효 수강생을 학생×과목으로 만들고, 그 과목 반이 전부 결석인 학생은 제외한다.
 * lesson_reports에는 class_id가 없으므로 같은 과목 여러 반은 한 대상으로 합친다.
 * ⚠️ **eywa에 보고서를 쓰는 과목만** 센다(report-subjects.ts) — 영어는 ClassNote에 직접 쓰므로
 *    여기선 늘 0건이라, 세면 신호가 아니라 소음이 된다.
 */
async function unwrittenReportsSignal(
  supabase: Supabase,
  today: string,
  nowMinutes: number,
  db?: TenantScope,
  trackedSubjects?: readonly string[] | null,
): Promise<TodayActionsRaw["unwrittenReportsToday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await scopeTenant(
    supabase
      .from("class_schedules")
      .select(
        `class_id, start_time,
       class:class_id!inner ( subject, is_active, closed_at, report_optout )`,
      )
      .eq("day_of_week", dayKey)
      .eq("class.is_active", true)
      .lte("valid_from", today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("start_time"),
    db,
  );
  const scheduleRows = rowsOrThrow(scheduleResult, "lesson report schedules") as unknown as ScheduleRow[];
  const subjectByClass = new Map<string, string>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    // 🔴 '수업보고서 미발송' 반(0174a)은 재촉하지 않는다. 이 신호는 작성률(report-admin/queries)과
    //    **완전히 별도 경로**라, 여기를 빼먹으면 표에선 사라진 반을 대시보드·일일 브리핑이 계속 재촉해
    //    두 화면이 서로 다른 말을 한다(2026-07-22 재발 패턴).
    if (!klass?.subject || (klass.closed_at && klass.closed_at < today) || klass.report_optout) continue;
    // 🔴 eywa에 보고서를 쓰지 않는 과목은 세지 않는다(원장 2026-08-29 "영어보고서는 운영실에서 제외").
    //    영어 강사는 ClassNote에 직접 쓰므로 lesson_reports가 늘 0건 — 세면 매일 140명이 '미작성'으로
    //    잡혀 진짜 미작성(수학 32명)이 그 안에 묻힌다. 축은 학원설정(report.classnoteSubjects).
    if (!isReportTrackedSubject(klass.subject, trackedSubjects)) continue;
    const [hour, minute] = row.start_time.slice(0, 5).split(":").map(Number);
    const startMinutes = (hour ?? Number.NaN) * 60 + (minute ?? Number.NaN);
    if (!Number.isFinite(startMinutes) || nowMinutes < startMinutes) continue;
    subjectByClass.set(row.class_id, klass.subject);
  }

  const classIds = [...subjectByClass.keys()];
  if (classIds.length === 0) return { count: 0, names: [], bySubject: [] };

  // B2: 이 조회는 end_date 필터 없이 과거 수강 이력까지 받아 JS로 거른다 — 청크 1개 응답이 1000행을
  // 넘으면 silent 절단돼 '오늘 미작성 보고서' 명단이 조용히 샌다. 같은 데이터를 읽는
  // unrecordedClassesSignal·getDailyProcessingStatus와 동일하게 fetchAllPagedInChunks(페이징)로.
  const enrollmentRows = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
    attendance_days: string[] | null;
  }>(classIds, (chunk, from, to) =>
    scopeTenant(
      supabase
        .from("enrollments")
        .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
        .lte("start_date", today)
        .in("class_id", chunk),
      db,
    )
      // OFFSET 페이지 안정화 — unique tie-break order 필수(batch.ts 계약)
      .order("id")
      .range(from, to),
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
  if (studentIds.length === 0) return { count: 0, names: [], bySubject: [] };

  const [attendanceRows, reportRows] = await Promise.all([
    fetchInChunks<{ id: string; student_id: string; class_id: string; status: string; recorded_at: string }>(
      studentIds,
      (chunk) =>
        scopeTenant(
          supabase
            .from("attendance_records")
            .select("id, student_id, class_id, status, recorded_at")
            .eq("session_date", today)
            .in("student_id", chunk)
            .order("recorded_at", { ascending: false })
            .order("id", { ascending: false }),
          db,
        ),
    ),
    fetchInChunks<{ student_id: string; subject: string | null }>(studentIds, (chunk) =>
      scopeTenant(
        supabase
          .from("lesson_reports")
          .select("student_id, subject")
          .eq("report_date", today)
          .in("student_id", chunk),
        db,
      ),
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
  const missingPairs = findMissingLessonReportPairs(
    targets,
    absentClassKeys,
    reportRows.map((row) => ({ studentId: row.student_id, subject: row.subject })),
  );
  // 건수·명단은 예전과 같은 **학생 단위**(dedupe), 분해만 학생×과목 쌍으로 센다.
  const missingStudentIds = [...new Set(missingPairs.map((pair) => pair.studentId))];
  const bySubjectMap = new Map<string, number>();
  for (const pair of missingPairs) bySubjectMap.set(pair.subject, (bySubjectMap.get(pair.subject) ?? 0) + 1);
  const bySubject = [...bySubjectMap].map(([subject, count]) => ({ subject, count }));
  if (missingStudentIds.length === 0) return { count: 0, names: [], bySubject: [] };

  const studentRows = await fetchInChunks<{ id: string; name: string }>(missingStudentIds.slice(0, 100), (chunk) =>
    scopeTenant(supabase.from("students").select("id, name").in("id", chunk), db),
  );
  const nameById = new Map(studentRows.map((student) => [student.id, student.name]));
  return {
    count: missingStudentIds.length,
    names: missingStudentIds.slice(0, 100).map((id) => nameById.get(id) ?? "(학생)"),
    bySubject,
  };
}

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "오늘 조치할 것" 원시 신호 수집. 독립 조회는 병렬로 실행하고, scope=false 도메인은 DB 호출도 하지 않는다.
 * 조회 실패는 해당 도메인의 sourceIssues로 반환해 빈 배열/0건과 구분한다.
 *
 * opts.db = cron(세션 없음) 경로: admin client + 명시 tenant 필터(scopeTenant). ⚠️ 새 쿼리를 추가하면
 * 반드시 scopeTenant를 감쌀 것 — admin은 RLS 우회라 한 곳만 빠져도 교차 테넌트 누수다.
 * opts.asOf = 기준 시점 주입: 아침 브리핑 cron이 '어제'를 기준일로 수집할 때 사용(미주입 = 지금·오늘).
 */
export async function getTodayActionSignals(
  scope: TodayActionSignalScope = {},
  opts?: { db?: DashboardSignalsDb; asOf?: DashboardSignalsAsOf },
): Promise<TodayActionsRaw> {
  const db = opts?.db;
  const supabase = db?.supabase ?? (await createClient());
  const today = opts?.asOf?.date ?? kstToday();
  const nowMinutes = opts?.asOf?.nowMinutes ?? kstMinutesOfDay();
  const yesterday = daysBefore(today, 1);
  const sevenDayStart = inclusiveDateWindowStart(today, 7);
  const failedCutoff = `${sevenDayStart}T00:00:00+09:00`;
  const enabled = (key: keyof TodayActionSignalScope) => scope[key] !== false;
  // 보고서 신호가 셀 과목(학원설정 report.classnoteSubjects). 🔴 fail-soft — 설정 조회가 실패해도
  //    신호를 죽이지 않는다. null이면 isReportTrackedSubject가 전부 센다(지금까지의 동작).
  const trackedSubjects = enabled("lessonReports")
    ? await (db ? getTenantSettingsByTenantId(db.tenantId) : getTenantSettings())
        .then((st) => st.report.classnoteSubjects ?? null)
        .catch(() => null)
    : null;
  const staffApprovalsEnabled = scope.staffApprovals ?? enabled("staff");

  const failedCount = async (
    table: "meeting_minutes" | "enrollment_consultations" | "student_consultations",
  ): Promise<number> => {
    const result = await scopeTenant(
      supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("processing_status", "failed")
        .gte("updated_at", failedCutoff),
      db,
    );
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
    classnoteAttention,
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
          scopeTenant(
            supabase
              .from("attendance_records")
              .select(
                "id, student_id, class_id, session_date, status, recorded_at, student:student_id ( name ), class:class_id ( subject )",
              )
              .eq("session_date", today)
              .order("recorded_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
            db,
          ),
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
      () => unrecordedClassesSignal(supabase, yesterday, db),
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
          scopeTenant(supabase.from("makeedu_sync_state").select("domain, status, synced_at"), db),
          scopeTenant(
            supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu"),
            db,
          ).maybeSingle(),
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
      { total: 0, recent: 0 },
      async () => {
        // ⚠️ 총건수와 최근 7일분을 **둘 다** 센다. 예전엔 7일분만 세고 그걸 총건수처럼 표시해,
        // 몇 달째 잠긴 결재가 통째로 안 보였다(2026-07-31 실측: 표시 13건 / 실제 미결 171건).
        const [totalRes, recentRes] = await Promise.all([
          scopeTenant(
            supabase.from("expenses").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
            db,
          ),
          scopeTenant(
            supabase
              .from("expenses")
              .select("*", { count: "exact", head: true })
              .eq("approval_status", "pending")
              .gte("expense_date", sevenDayStart),
            db,
          ),
        ]);
        return {
          total: countOrThrow(totalRes, "pending expenses"),
          recent: countOrThrow(recentRes, "pending expenses (7d)"),
        };
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
        const result = await scopeTenant(
          supabase
            .from("textbook_orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "requested"),
          db,
        );
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
        const result = await scopeTenant(
          supabase
            .from("staff_leaves")
            .select("*", { count: "exact", head: true })
            .is("approved_at", null)
            .gte("ends_on", today),
          db,
        );
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
        const result = await scopeTenant(
          supabase
            .from("staff_leaves")
            .select("user:user_id ( display_name )")
            .not("approved_at", "is", null)
            .lte("starts_on", today)
            .gte("ends_on", today)
            .limit(20),
          db,
        );
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
      { count: 0, names: [], bySubject: [] },
      () => unwrittenReportsSignal(supabase, today, nowMinutes, db, trackedSubjects),
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
      { students: [] as { studentId: string; name: string }[], total: 0 },
      // students 기준 anti-join RPC(0097a). 등록상담이 아니라 학생이 출처다.
      // db(cron) 경로는 p_tenant 변형 RPC — 세션용 RPC는 service_role에서 에러 없이 0행(silent 오보).
      // ⚠️ 30은 **미리보기 상한**이다 — 건수는 반드시 total(0159a)에서 온다(배열 길이 사용 금지).
      () => getUnassignedEnrolledStudents(30, db ? { supabase: db.supabase, tenantId: db.tenantId } : undefined),
    ),
    collectSignal(
      enabled("lessonReports"),
      {
        key: "classnote-attention",
        label: "리포트 발송 큐",
        href: "/lesson-reports?tab=writing",
        menuKey: "lesson_reports",
        requiredAccess: "read",
      },
      { failed: 0, tooOld: 0, humanHold: 0, stuck: 0 },
      async () => {
        // 판정 기준은 classnote-queue.ts와 동일: failed/too_old는 7일 창(분석실패 신호 관례와 동형),
        // 사람 조치 보류(blocked_shared·name_conflict)는 **창 없음**(3일 창 때문에 재발송 버튼과 함께
        // 행이 사라져 해소 불가능해진 실사고 교훈), 멈춤 = processing 10분 초과. 전부 head-count(B2).
        const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
        const [failedRes, tooOldRes, holdRes, stuckRes] = await Promise.all([
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "failed")
              .gte("report_date", sevenDayStart),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "too_old")
              .gte("report_date", sevenDayStart),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .in("classnote_status", [...HUMAN_RESOLVED_STATUSES]),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "processing")
              .lte("classnote_processing_at", stuckCutoff),
            db,
          ),
        ]);
        return {
          failed: countOrThrow(failedRes, "classnote failed"),
          tooOld: countOrThrow(tooOldRes, "classnote too_old"),
          humanHold: countOrThrow(holdRes, "classnote human-hold"),
          stuck: countOrThrow(stuckRes, "classnote stuck"),
        };
      },
    ),
  ]);

  const seen = new Map<string, { name: string; subject: string | null }>();
  for (const row of absent.value) {
    if (seen.has(row.student_id)) continue;
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) ?? undefined;
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    seen.set(row.student_id, { name: student?.name ?? "(학생)", subject: klass?.subject ?? null });
  }

  let makeeduIssue: TodayActionsRaw["makeeduIssue"] = null;
  if (makeedu.value.syncEnabled && makeedu.value.rows.length > 0) {
    const errors = makeedu.value.rows.filter((row) => row.status !== "ok");
    if (errors.length > 0) {
      makeeduIssue = { kind: "error", detail: `${errors.map((error) => error.domain).join("·")} 실패` };
    } else {
      // ⚠️ **도메인별로** 판정한다. 예전엔 전 도메인 max(synced_at) 하나만 봐서, 임포터가 도메인별로
      // 실패 격리되는 구조상 invoices만 몇 주 멈춰도 다른 도메인이 신선하면 경고가 절대 안 떴다
      // (그 도메인 행은 recordSync에 도달 못 해 status도 옛 'ok'로 남아 위 errors 필터에도 안 걸린다).
      const stale = makeedu.value.rows
        // 수동 전용 도메인은 자동 동기화 대상이 아니라 영원히 낡는다 — 제외(MANUAL_ONLY_DOMAINS 주석).
        .filter((row) => !MANUAL_ONLY_DOMAINS.has(row.domain))
        .map((row) => ({ domain: row.domain, hours: Math.floor((Date.now() - Date.parse(row.synced_at)) / 3_600_000) }))
        .filter((row) => row.hours >= 26)
        .sort((a, b) => b.hours - a.hours);
      if (stale.length > 0) {
        makeeduIssue = {
          kind: "stale",
          detail: `${stale.map((s) => DOMAIN_LABEL[s.domain] ?? s.domain).join("·")} ${stale[0]!.hours}시간째 미동기`,
        };
      }
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
    classnoteAttention,
  ];

  return {
    absentToday: [...seen].map(([studentId, info]) => ({ studentId, ...info })),
    unrecordedYesterday: dailyProcessing.value,
    yesterday,
    failedAnalysis: {
      meetings: failedMeetings.value,
      enrollment: failedEnrollment.value,
      consultations: failedConsultations.value,
    },
    makeeduIssue,
    pendingExpenses: { total: expenses.value.total, recent: expenses.value.recent },
    requestedTextbooks: textbooks.value,
    leavesPending: leavesPending.value,
    leavesToday: leavesToday.value.map((row) => {
      const user = (Array.isArray(row.user) ? row.user[0] : row.user) ?? undefined;
      return { name: user?.display_name ?? "(직원)" };
    }),
    unwrittenReportsToday: unwrittenReports.value,
    unassignedEnrolled: unassignedEnrolled.value.students.map((student) => ({
      studentId: student.studentId,
      name: student.name,
    })),
    unassignedEnrolledTotal: unassignedEnrolled.value.total,
    classnoteAttention: classnoteAttention.value,
    sourceIssues: collected.flatMap((result) => (result.issue ? [result.issue] : [])),
  };
}
