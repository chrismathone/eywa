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
import { includeInAttendanceInput, makeupStudentIds } from "@/features/attendance/input-roster";
import { buildHolidayMap, dowsFromKeys, resolveAttendDows } from "@/features/attendance/calendar";
import {
  deriveMarksFromReports,
  isDerivedAttendanceSubject,
  REQUIRE_SENT_REPORT,
} from "@/features/attendance/derive-from-reports";
import { getTenantSettings } from "@/features/owner/server/queries";

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
  /** 그 반 수강행 id. **보강(수업외) 학생은 수강행이 없어 null**. */
  enrollmentId: string | null;
  /**
   * 보강(수업외) 참석 — 그 반 수강생이 아닌데 그날 와서 수업을 들은 학생.
   * 원스크린 '+ 보강 학생 추가'(보고서)와 같은 개념의 출결판. 처리현황 '예정' 분모엔 안 들어간다.
   */
  isMakeup: boolean;
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

/**
 * Active enrollments + their current attendance record for one (class, date).
 *
 * ⚠️ 수강 판정은 **공용 헬퍼**(isEnrollmentActiveOn·enrollmentAttendsOnDay)로만 한다 — 손으로 다시
 * 구현하지 말 것. 예전 이 함수는 `!on_hold && (!end_date || end_date >= date)`만 봐서 **분리등원
 * (attendance_days)을 select조차 안 했고** is_transferred도 무시했다. 그래서 같은 날짜에 대해
 * 처리현황(위 getDailyProcessingStatus, 헬퍼 사용)은 "예정 M명"인데 '입력' 화면은 M보다 많은 명단을
 * 보여주고, 그 요일에 오지 않는 학생까지 출결을 찍을 수 있었다(2026-07-22 전수검사 실측: 월7·화7·목9·금5명,
 * 17개 반 — 원스크린 로스터에서 고친 것과 **같은 숫자·같은 원인**, main 6db1c3ca). 찍힌 기록은
 * session_units(시수)를 타고 시수 검증·강사 분배로 흘러가는데 expected 집합 밖이라 완료율엔 영원히 안 잡힌다.
 *
 * ⚠️ 단 **이미 기록이 있는 학생은 등원요일 밖이어도 반드시 남긴다**(아래 `hasRecord` 합집합).
 * 필터만 걸면 과거에 이미 찍힌 기록이 화면에서 통째로 사라져 **수정·삭제할 방법이 없어진다**
 * (실측 52행: 2026-02~06, 대부분 보강 등으로 정규 요일 밖에 찍힌 present). 새 오입력은 막되
 * 기존 기록은 숨기지 않는 게 규약 — "안 보이는데 존재하는 데이터"를 만들지 말 것.
 */
export async function getAttendanceInputRows(
  classId: string,
  date: string,
): Promise<AttendanceInputRow[]> {
  const supabase = await createClient();
  const dayEnum = DOW_ENUM[new Date(`${date}T00:00:00Z`).getUTCDay()];

  // 반·날짜 단위 조회라 학생 필터 없이 받는다(한 반 명단 규모라 절단 위험 없음) — 등원요일 밖에
  // 이미 찍힌 기록을 알아야 그 행을 남길지 판단할 수 있어, 명단보다 **먼저** 읽는다.
  const [{ data: enrollments }, { data: records }] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        `id, start_date, end_date, on_hold, is_transferred, attendance_days,
       student:student_id ( id, name, grade )`,
      )
      .eq("class_id", classId)
      .lte("start_date", date),
    supabase
      .from("attendance_records")
      .select("id, student_id, status, note, homework_required, homework_done, session_units, recorded_at")
      .eq("class_id", classId)
      .eq("session_date", date)
      .order("recorded_at", { ascending: false }),
  ]);

  // Keep the latest record per student (records are sorted desc by recorded_at)
  const recordMap = new Map<
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

  const active = (enrollments ?? []).filter((e) => {
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as { id: string } | undefined;
    return includeInAttendanceInput(
      {
        startDate: e.start_date,
        endDate: e.end_date,
        onHold: e.on_hold,
        isTransferred: e.is_transferred === true,
        attendanceDays: e.attendance_days,
      },
      date,
      dayEnum,
      !!(s && recordMap.has(s.id)),
    );
  });

  const rosterRows = active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null }
        | undefined;
      if (!s) return null;
      const existing = recordMap.get(s.id);
      const row: AttendanceInputRow = {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        enrollmentId: e.id,
        isMakeup: false,
        existingRecordId: existing?.id ?? null,
        status: existing?.status ?? null,
        note: existing?.note ?? null,
        homeworkRequired: existing?.homeworkRequired ?? false,
        homeworkDone: existing?.homeworkDone ?? false,
        sessionUnits: existing?.sessionUnits ?? null,
      };
      return row;
    })
    .filter((r): r is AttendanceInputRow => r !== null);

  // ── 보강(수업외) 참석 ── 그 반 수강생이 아닌데 그날 기록이 있는 학생.
  // 강사가 '+ 보강 학생 추가'로 저장하면 수강행이 없어 위 명단엔 절대 안 잡힌다 → 여기서 합쳐야
  // 저장 뒤에도 보이고 **수정·삭제가 가능**하다(안 그러면 "안 보이는데 존재하는 데이터"가 된다).
  // 이관분에도 이런 행이 다수 있어(실측 1,264행/2026-02~06) 과거 날짜를 열면 그것도 함께 드러난다.
  const enrolledIds = new Set(
    (enrollments ?? [])
      .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student) as { id: string } | undefined)
      .filter((s): s is { id: string } => !!s)
      .map((s) => s.id),
  );
  const makeupIds = makeupStudentIds([...recordMap.keys()], [...enrolledIds]);
  let makeupRows: AttendanceInputRow[] = [];
  if (makeupIds.length > 0) {
    const students = await fetchInChunks<{ id: string; name: string; grade: string | null }>(
      makeupIds,
      (chunk) => supabase.from("students").select("id, name, grade").in("id", chunk),
    );
    makeupRows = students.map((s): AttendanceInputRow => {
      const existing = recordMap.get(s.id);
      return {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        enrollmentId: null,
        isMakeup: true,
        existingRecordId: existing?.id ?? null,
        status: existing?.status ?? null,
        note: existing?.note ?? null,
        homeworkRequired: existing?.homeworkRequired ?? false,
        homeworkDone: existing?.homeworkDone ?? false,
        sessionUnits: existing?.sessionUnits ?? null,
      };
    });
  }

  const byName = (a: AttendanceInputRow, b: AttendanceInputRow) => {
    const ga = a.studentGrade ?? "";
    const gb = b.studentGrade ?? "";
    if (ga !== gb) return ga.localeCompare(gb, "ko");
    return a.studentName.localeCompare(b.studentName, "ko");
  };
  // 정규 명단 먼저, 보강은 아래로 묶어 표시(섞이면 "이 반 학생"으로 오인된다).
  return [...rosterRows.sort(byName), ...makeupRows.sort(byName)];
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
  // 등원요일(0=일~6=토) — 분리등원(enrollments.attendance_days)이 있으면 그 요일, 없으면 반 수업요일 전체.
  attendDows: number[];
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
  // 선택한 반의 수업요일(0=일~6=토) — 그 달에 유효한 class_schedules 기준. 헤더 하이라이트용.
  classDows: number[];
  students: MatrixStudent[];
  // studentId → date → status
  marks: Record<string, Record<string, AttendanceStatus>>;
  // studentId → date → note (사유) — 매트릭스 인디케이터/툴팁용
  notes: Record<string, Record<string, string>>;
  // studentId → date → 시수(배수, 0115a). 기록이 없거나 기본(1)이면 키 없음 — 셀 표시·시수 합계용.
  units: Record<string, Record<string, number>>;
  // studentId → date → true. **수기 기록이 아니라 수업보고서에서 파생한 칸**(derive-from-reports.ts).
  // 화면이 사실과 다른 말을 하지 않도록 셀 툴팁에 출처를 밝히는 용도 — 수기로 덮으면 이 표시는 사라진다.
  derived: Record<string, Record<string, true>>;
  // 이 반이 파생 대상인지(수학=대상, 영어=미가동). 표에 안내 문구를 띄울지 결정.
  derivedActive: boolean;
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
      classDows: [],
      students: [],
      marks: {},
      notes: {},
      units: {},
      derived: {},
      derivedActive: false,
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

  // 해당 반의 활성 학생 + 그 반의 수업요일 — 서로 독립이라 병렬로(B4).
  const [{ data: enrollments }, { data: schedules }] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        `id, start_date, end_date, on_hold, attendance_days,
       student:student_id ( id, name, grade, school )`,
      )
      .eq("class_id", classId)
      .lte("start_date", endIso),
    // 그 달과 유효기간이 겹치는 스케줄만(월 중 요일이 바뀐 반은 합집합 — 표시용 하이라이트라 넉넉히).
    supabase
      .from("class_schedules")
      .select("day_of_week")
      .eq("class_id", classId)
      .lte("valid_from", endIso)
      .or(`valid_to.is.null,valid_to.gte.${startIso}`),
  ]);

  const classDows = dowsFromKeys((schedules ?? []).map((s) => s.day_of_week as string));

  const studentMap = new Map<string, MatrixStudent>();
  // 파생 판정용 수강 구간 — 한 학생이 같은 반에 재등록해 여러 행일 수 있어 **전 구간**을 모은다
  // (studentMap은 첫 행만 담으므로 그것만 보면 재등록 이전 기간을 통째로 결석 처리한다).
  const rangesById = new Map<string, { start: string; end: string | null }[]>();
  for (const e of enrollments ?? []) {
    if (e.on_hold) continue;
    if (e.end_date && e.end_date < startIso) continue;
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
      | { id: string; name: string; grade: string | null; school: string | null }
      | undefined;
    if (!s) continue;
    const list = rangesById.get(s.id) ?? [];
    list.push({ start: e.start_date as string, end: (e.end_date as string | null) ?? null });
    rangesById.set(s.id, list);
    if (!studentMap.has(s.id)) {
      studentMap.set(s.id, {
        id: s.id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
        attendDows: resolveAttendDows(e.attendance_days as string[] | null, classDows),
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
  const derived: Record<string, Record<string, true>> = {};

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
    }
  }

  // ── 수업보고서 파생(2026-07-21 원장 지시) — 수학 반의 **수기 기록이 없는 등원일**만 메운다.
  // 규칙·근거는 derive-from-reports.ts. 여기선 "등원일" 판정을 화면(page.tsx)과 **똑같이** 한다:
  // 학생 등원요일 ∩ 그 달 날짜, 공휴일 제외, 수강 구간 안. 어긋나면 화면과 파생이 서로 다른 말을 한다.
  const selectedClass = classes.find((c) => c.id === classId);
  const derivedActive = isDerivedAttendanceSubject(selectedClass?.subject);
  if (derivedActive && selectedClass && studentIds.length > 0) {
    const [reports, settings] = await Promise.all([
      // 학생 수 × 최대 31일이라 청크당 1000행을 넘길 여지는 낮지만, 반 인원은 상한이 없다(B2).
      // ⚠️ 반으로 **거르지 않고** 그 달 보고서를 다 가져온 뒤 JS에서 세 갈래로 나눈다
      //    (이 반 것 / 같은 과목 다른 반 것 / 무관). 쿼리를 반으로 좁히면 "짝 반이 썼는지"를
      //    알 수 없어 판정 보류를 못 한다 — 그게 거짓 결석의 원인이었다(아래 sibling 주석).
      fetchAllPagedInChunks<{ student_id: string; report_date: string; class_id: string | null }>(
        studentIds,
        (chunk, from, to) => {
          let q = supabase
            .from("lesson_reports")
            .select("student_id, report_date, class_id")
            .in("student_id", chunk)
            .gte("report_date", startIso)
            .lte("report_date", endIso);
          // 기본은 '작성됨'. 발송 성공만 인정하려면 REQUIRE_SENT_REPORT를 켠다(근거는 그 상수 주석).
          if (REQUIRE_SENT_REPORT) q = q.eq("classnote_status", "success");
          return q
            .order("report_date", { ascending: false })
            .order("id", { ascending: false }) // OFFSET 페이지 안정용 unique tie-break
            .range(from, to);
        },
      ),
      getTenantSettings(),
    ]);
    // 🔴 반 단위 분류(0134a) — 세 갈래다:
    //  · 이 반(또는 반 미상 = 이관분·보강·관리자 작성) → **출석 파생 근거**.
    //  · 같은 과목 **다른 반** → 출석도 결석도 아닌 **판정 보류**. 실데이터에 "한 수업, 두 수강행"이
    //    있어 강사는 한 번 가르치고 한 건만 쓴다. 보류가 없으면 짝 반의 그 날짜가 매주 영구히 거짓 결석.
    //  · 그 외 과목 → 무시.
    //
    // 🔴 짝 반 판정을 위 `classes`로 하면 **안 된다** — 그 목록은 강사뷰에서 `teacher_id`로 좁혀져 있다.
    //    실측(2026-07-22) 짝 반은 전부 **다른 강사** 소유였다(JJPS 마수호 ↔ PS2S 이성우, JJ1E 김은정 ↔
    //    JJ1I 이유정). 그래서 좁힌 목록으로 판정하면 **정작 그 화면을 보는 강사에게만** 짝 반이 안 보여
    //    거짓 결석이 그대로 남는다(관리자 화면에서만 고쳐진 것처럼 보인다).
    //    → 보고서에 실제로 붙어 있는 class_id들의 과목을 **직접** 조회한다(테넌트 RLS만 적용, 강사 무관).
    const otherClassIds = [
      ...new Set(
        reports
          .map((r) => r.class_id)
          .filter((c): c is string => !!c && c !== selectedClass.id),
      ),
    ];
    const otherClasses = otherClassIds.length
      ? await fetchInChunks<{ id: string; subject: string | null }>(otherClassIds, (chunk) =>
          supabase.from("classes").select("id, subject").in("id", chunk),
        )
      : [];
    const sameSubjectClassIds = new Set(
      otherClasses.filter((c) => c.subject === selectedClass.subject).map((c) => c.id),
    );
    const reportsByStudent = new Map<string, Set<string>>();
    const siblingByStudent = new Map<string, Set<string>>();
    for (const r of reports) {
      const cid = r.class_id;
      const mine = !cid || cid === selectedClass.id;
      const sibling = !mine && sameSubjectClassIds.has(cid);
      if (!mine && !sibling) continue; // 다른 과목 보고서 — 이 출석부와 무관
      const target = mine ? reportsByStudent : siblingByStudent;
      const set = target.get(r.student_id) ?? new Set<string>();
      set.add(r.report_date);
      target.set(r.student_id, set);
    }
    const holidays = buildHolidayMap(settings.operations.holidays);
    const todayIso = kstToday();
    const realDays = days.filter((d) => !d.placeholder && !holidays[d.date]);

    for (const s of students) {
      const dows = new Set(s.attendDows);
      const ranges = rangesById.get(s.id) ?? [];
      const attendDates = realDays
        .filter((d) => dows.has(d.dow))
        .filter((d) => ranges.some((r) => r.start <= d.date && (!r.end || r.end >= d.date)))
        .map((d) => d.date);
      const got = deriveMarksFromReports({
        attendDates,
        reportDates: reportsByStudent.get(s.id) ?? new Set(),
        siblingReportDates: siblingByStudent.get(s.id),
        manualDates: new Set(Object.keys(marks[s.id] ?? {})),
        today: todayIso,
      });
      for (const [date, mark] of Object.entries(got)) {
        marks[s.id] ??= {};
        marks[s.id]![date] = mark;
        derived[s.id] ??= {};
        derived[s.id]![date] = true;
      }
    }
  }

  // 통계는 수기 + 파생을 **합친 뒤** 센다 — 파생만 있는 반이 출석률 0%로 보이면 안 된다.
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let makeupCount = 0;
  let totalRecords = 0;
  for (const byDate of Object.values(marks)) {
    for (const status of Object.values(byDate)) {
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
    classDows,
    students,
    marks,
    notes,
    units,
    derived,
    derivedActive,
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
