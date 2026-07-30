import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { mondayOf, shiftDays, weekLabel, weekRelation } from "@/features/timetable/lib/week";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getTeacherLabelMap } from "@/features/timetable/server/queries";
import { resolveTeacherLabel } from "@/features/timetable/lib/teacher-label";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import {
  buildWeekGrid,
  scheduledSlotKeySet,
  sheetFillStats,
  type GridPlanLine,
  type WeekGrid,
} from "../lib/grid";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { normalizeSlotTime, weekDatesOf, YMD_RE, type DowKey } from "../lib/week";
import { ecsVisibleClassFilter, requireEcsClassAccess } from "./access";

/**
 * ECS 주간 시트 로더 — 게이트(requireEcsClassAccess) 통과 후 admin client(service_role)로만 읽는다
 * (class_sheet_*는 deny-RLS). 조회는 전부 tenant_id + class_id 이중 필터(§A 결속).
 */

export type SheetStudentMeta = {
  name: string;
  school: string | null;
  grade: string | null;
  englishName: string | null;
};

export type SheetGoalDTO = {
  scope: "month" | "week";
  periodStart: string;
  role: "homeroom" | "assistant";
  skillArea: string;
  textbook: string | null;
  targetProgress: string | null;
};

export type ClassSheetWeekData = {
  classId: string;
  className: string;
  weekMonday: string;
  weekLabel: string;
  weekRelation: "past" | "current" | "future";
  today: string;
  canWrite: boolean;
  /** 날짜별 출석 present 체크 가능 여부(attendance 계약 — 권한 + 강사 7일 창). */
  canMarkAttendanceByDate: Record<string, boolean>;
  skillAreas: SkillAreaSetting[];
  grid: WeekGrid;
  /** teacherId → 표시 이름(users.display_name). 슬롯 라벨(slot_teacher_label)이 없을 때 폴백. */
  teacherNames: Record<string, string>;
  classTeacherName: string | null;
  students: Record<string, SheetStudentMeta>;
  /** `${studentId}|${date}` → attendance_status(effective). */
  attendanceByStudentDate: Record<string, string>;
  /** `${studentId}|${date}|${HH:MM}` → 마크. */
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  goals: SheetGoalDTO[];
  monthStart: string;
  memos: Record<string, string>;
  /** `${date}|${HH:MM}` → "N교시". 요일별 교시표로 확정(주말은 평일과 시각이 달라 표가 다르다) — 표시 전용. */
  periodLabelBySlot: Record<string, string>;
  fill: { totalSlots: number; filledSlots: number; orphanSlots: number };
};

export async function getClassSheetWeek(
  classId: string,
  weekParam?: string | null,
): Promise<{ ok: true; data: ClassSheetWeekData } | { ok: false; error: string }> {
  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { access } = gate;
  const tenantId = access.tenantId;

  const today = kstToday();
  const weekMonday = mondayOf(weekParam && YMD_RE.test(weekParam) ? weekParam : today);
  const weekSunday = shiftDays(weekMonday, 6);
  const monthStart = `${weekMonday.slice(0, 7)}-01`;

  const admin = createAdminClient();
  const [
    schedulesRes,
    enrollmentsRes,
    planLinesRes,
    weekGoalsRes,
    monthGoalsRes,
    marksRes,
    attendanceRes,
    memosRes,
    settings,
    labelMap,
  ] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, slot_teacher_label, slot_room_label")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .lte("valid_from", weekSunday)
      .or(`valid_to.is.null,valid_to.gte.${weekMonday}`),
    admin
      .from("enrollments")
      .select(
        "student_id, start_date, end_date, on_hold, is_transferred, attendance_days, students!inner(id, name, school, grade, english_name, withdrawn_at)",
      )
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .lte("start_date", weekSunday)
      .or(`end_date.is.null,end_date.gte.${weekMonday}`),
    admin
      .from("class_sheet_plan_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("plan_date", weekMonday)
      .lte("plan_date", weekSunday)
      .order("plan_date")
      .order("slot_start")
      .order("term_mode")
      .order("line_no"),
    admin
      .from("class_sheet_goals")
      .select("scope, period_start, role, skill_area, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("scope", "week")
      .eq("period_start", weekMonday),
    admin
      .from("class_sheet_goals")
      .select("scope, period_start, role, skill_area, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("scope", "month")
      .eq("period_start", monthStart),
    admin
      .from("class_sheet_student_marks")
      .select("student_id, mark_date, slot_start, status, progress_note")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("mark_date", weekMonday)
      .lte("mark_date", weekSunday),
    admin
      .from("attendance_records")
      .select("id, student_id, class_id, session_date, status, recorded_at")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("session_date", weekMonday)
      .lte("session_date", weekSunday),
    admin
      .from("class_sheet_memos")
      .select("memo_key, body")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("week_start", weekMonday),
    getTenantSettings(),
    // 강사 라벨 해석기(시간표와 **같은 단일 소스**) — slot_teacher_label 원문은 ijw 시트의 영문 닉네임
    // ("Hannah")·옛 이름("이주희")이라 그대로 그리면 시간표는 "이현이/LAB"인데 ECS만 다른 이름이 뜬다
    // (원장 제보 2026-07-29). DB 원문은 시트 동기의 원본이라 건드리지 않고 **표시할 때만** 해석한다.
    // admin 클라이언트를 주입해 tenantId로 좁힌다(무인자 호출은 쿠키 세션 경로라 admin 흐름과 섞인다).
    getTeacherLabelMap({ supabase: admin, tenantId }),
  ]);

  for (const r of [schedulesRes, enrollmentsRes, planLinesRes, weekGoalsRes, monthGoalsRes, marksRes, attendanceRes, memosRes]) {
    if (r.error) return { ok: false, error: `시트 데이터를 불러오지 못했습니다: ${r.error.message}` };
  }

  type EnrollmentRow = {
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
    students: {
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
      english_name: string | null;
      withdrawn_at: string | null;
    };
  };
  const enrollments = (enrollmentsRes.data ?? []) as unknown as EnrollmentRow[];

  const planLines: GridPlanLine[] = (planLinesRes.data ?? []).map((l) => ({
    id: l.id as string,
    planDate: l.plan_date as string,
    slotStart: l.slot_start as string,
    termMode: l.term_mode as "regular" | "exam",
    skillArea: l.skill_area as string,
    lineNo: Number(l.line_no),
    textbook: (l.textbook as string | null) ?? null,
    pageRange: (l.page_range as string | null) ?? null,
    progress: (l.progress as string | null) ?? null,
    homework: (l.homework as string | null) ?? null,
    updatedAt: l.updated_at as string,
  }));

  const marks = (marksRes.data ?? []).map((m) => ({
    studentId: m.student_id as string,
    markDate: m.mark_date as string,
    slotStart: m.slot_start as string,
    status: (m.status as string | null) ?? null,
    progressNote: (m.progress_note as string | null) ?? null,
  }));

  const effAttendance = effectiveAttendanceRecords(
    (attendanceRes.data ?? []).map((a) => ({
      id: a.id as string,
      student_id: a.student_id as string,
      class_id: a.class_id as string,
      session_date: a.session_date as string,
      recorded_at: a.recorded_at as string,
      status: a.status as string,
    })),
  );

  const memoRows = (memosRes.data ?? []).map((m) => ({
    memoKey: m.memo_key as string,
    body: m.body as string,
  }));

  const grid = buildWeekGrid({
    weekMonday,
    schedules: (schedulesRes.data ?? []).map((s) => ({
      dayOfWeek: s.day_of_week as DowKey,
      startTime: s.start_time as string,
      endTime: s.end_time as string,
      validFrom: s.valid_from as string,
      validTo: (s.valid_to as string | null) ?? null,
      teacherId: (s.teacher_id as string | null) ?? null,
      // 해석은 여기(슬롯이 만들어지는 지점) 한 곳에서 — 컴포넌트마다 하면 표기가 갈린다(시간표 규약 동일).
      slotTeacherLabel: resolveTeacherLabel((s.slot_teacher_label as string | null) ?? null, labelMap),
      slotRoomLabel: (s.slot_room_label as string | null) ?? null,
    })),
    enrollments: enrollments.map((e) => ({
      studentId: e.student_id,
      startDate: e.start_date,
      endDate: e.end_date,
      onHold: e.on_hold,
      isTransferred: e.is_transferred ?? undefined,
      attendanceDays: e.attendance_days,
      withdrawnAt: e.students?.withdrawn_at ?? null,
    })),
    planLines,
    marks,
    attendance: effAttendance.map((a) => ({
      studentId: a.student_id,
      sessionDate: a.session_date,
      status: a.status,
    })),
    slotMemoKeys: memoRows.map((m) => m.memoKey).filter((k) => k.startsWith("slot:")),
  });

  // 학생 메타 — enrollment 조인분 + (마크·출석만 있는 historical) 부족분 보충 조회
  const students: Record<string, SheetStudentMeta> = {};
  for (const e of enrollments) {
    if (e.students) {
      students[e.student_id] = {
        name: e.students.name,
        school: e.students.school,
        grade: e.students.grade,
        englishName: e.students.english_name,
      };
    }
  }
  const rosterIds = new Set<string>();
  for (const day of grid.days) for (const slot of day.slots) for (const r of slot.roster) rosterIds.add(r.studentId);
  for (const a of grid.attendanceOnly) for (const id of a.studentIds) rosterIds.add(id);
  const missing = [...rosterIds].filter((id) => !students[id]);
  if (missing.length > 0) {
    const rows = await fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null; english_name: string | null }>(
      missing,
      (chunk) =>
        admin
          .from("students")
          .select("id, name, school, grade, english_name")
          .eq("tenant_id", tenantId)
          .in("id", chunk),
    );
    for (const s of rows) {
      students[s.id] = { name: s.name, school: s.school, grade: s.grade, englishName: s.english_name };
    }
  }

  // 강사 표시 이름 — 슬롯 teacher_id + 반 담임
  const teacherIds = new Set<string>();
  for (const day of grid.days) for (const slot of day.slots) if (slot.teacherId) teacherIds.add(slot.teacherId);
  if (access.teacherId) teacherIds.add(access.teacherId);
  const teacherNames: Record<string, string> = {};
  if (teacherIds.size > 0) {
    const rows = await fetchInChunks<{ id: string; display_name: string | null }>([...teacherIds], (chunk) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
    );
    for (const u of rows) if (u.display_name) teacherNames[u.id] = u.display_name;
  }

  // 출석 present 체크 가능 여부 — attendance 계약 그대로(권한 + 강사만 7일 창, 날짜별 판정)
  const attendanceWrite = await canWriteTenant(access.user.systemRole, "attendance");
  const canMarkAttendanceByDate: Record<string, boolean> = {};
  for (const date of weekDatesOf(weekMonday)) {
    canMarkAttendanceByDate[date] =
      attendanceWrite &&
      (access.user.systemRole !== "teacher" || isWithinAttendanceEditWindow(date, today));
  }

  // 교시 라벨(표시 전용) — **요일별 표**로 슬롯마다 확정한다. 주말은 평일과 시각이 다른 별도 교시표를
  // 쓰므로(주말 09:00~ 1시간 / 영어 평일 14:20~ 40분), 평일표만 보면 주말 15:00~16:00 수업이
  // 평일 "2교시"(15:00~15:40)로 표시된다 — 시각이 다른 교시에 남의 번호를 붙이는 거짓 표시(원장 제보).
  // 키에 날짜를 넣는 이유: 같은 시각이라도 요일에 따라 교시 번호가 다르다.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor("english", periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const periodLabelBySlot: Record<string, string> = {};
  for (const day of grid.days) {
    const weekend = isWeekendDow(day.dow);
    for (const slot of day.slots) {
      const label = resolvePeriodLabel(slot.slotStart, slot.slotEnd, periodTables, weekend);
      if (label) periodLabelBySlot[`${day.date}|${slot.slotStart}`] = label;
    }
  }

  const attendanceByStudentDate: Record<string, string> = {};
  for (const a of effAttendance) attendanceByStudentDate[`${a.student_id}|${a.session_date}`] = a.status;

  const marksMap: Record<string, { status: string | null; progressNote: string | null }> = {};
  for (const m of marks) {
    marksMap[`${m.studentId}|${m.markDate}|${normalizeSlotTime(m.slotStart)}`] = {
      status: m.status,
      progressNote: m.progressNote,
    };
  }

  const goals: SheetGoalDTO[] = [...(weekGoalsRes.data ?? []), ...(monthGoalsRes.data ?? [])].map((g) => ({
    scope: g.scope as "month" | "week",
    periodStart: g.period_start as string,
    role: g.role as "homeroom" | "assistant",
    skillArea: g.skill_area as string,
    textbook: (g.textbook as string | null) ?? null,
    targetProgress: (g.target_progress as string | null) ?? null,
  }));

  const memos: Record<string, string> = {};
  for (const m of memoRows) memos[m.memoKey] = m.body;

  return {
    ok: true,
    data: {
      classId,
      className: access.className,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      weekRelation: weekRelation(weekMonday, today),
      today,
      canWrite: access.canWrite,
      canMarkAttendanceByDate,
      skillAreas: access.skillAreas,
      grid,
      teacherNames,
      classTeacherName: access.teacherId ? (teacherNames[access.teacherId] ?? null) : null,
      students,
      attendanceByStudentDate,
      marks: marksMap,
      goals,
      monthStart,
      memos,
      periodLabelBySlot,
      fill: sheetFillStats(grid),
    },
  };
}

// ── 랜딩(반 목록 + 작성 상태) ─────────────────────────────────────────────────

export type SheetLandingCard = {
  classId: string;
  className: string;
  teacherName: string | null;
  totalSlots: number;
  filledSlots: number;
  orphanSlots: number;
};

/**
 * 카드가 0개인 **이유** — 화면이 원인을 정확히 말하게 하려고 구분한다.
 * 담당 영어 반이 없는 강사에게 "학원 설정을 확인하라"고 하면 고칠 수 없는 일을 시키는 거짓 안내다.
 */
export type SheetLandingEmptyReason = "not-configured" | "no-scoped-classes" | "no-classes" | null;

export async function getSheetLanding(
  weekParam?: string | null,
): Promise<
  | {
      ok: true;
      weekMonday: string;
      weekLabel: string;
      today: string;
      cards: SheetLandingCard[];
      emptyReason: SheetLandingEmptyReason;
    }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const today = kstToday();
  const weekMonday = mondayOf(weekParam && YMD_RE.test(weekParam) ? weekParam : today);
  const weekSunday = shiftDays(weekMonday, 6);

  // ECS 대상 과목(v1: english + skillAreas 비어있지 않음) — 설정 단일 소스
  const settings = await getTenantSettings();
  const english = settings.operations.subjects.find((s) => s.key === "english");
  if (resolveSkillAreas(english).length === 0) {
    return {
      ok: true,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      today,
      cards: [],
      emptyReason: "not-configured",
    };
  }

  const supabase = await createClient();
  const { data: allClasses, error: classError } = await supabase
    .from("classes")
    .select("id, class_name, teacher_id")
    .eq("subject", "english")
    .eq("is_active", true)
    .or(`closed_at.is.null,closed_at.gte.${weekMonday}`)
    .order("class_name");
  if (classError) return { ok: false, error: `반 목록을 불러오지 못했습니다: ${classError.message}` };
  // 강사 스코프는 JS 교집합(스코프 id를 .in에 넣지 않는다 — 대량 .in 상한/silent cap 회피, B3).
  // 담당 반 ∪ 부담임 반(ecsVisibleClassFilter — 게이트 requireEcsClassAccess와 같은 확장 스코프).
  const { classIds: visibleIds } = await ecsVisibleClassFilter();
  const scopeSet = visibleIds ? new Set(visibleIds) : null;
  const classes = (allClasses ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string));
  const classIds = classes.map((c) => c.id as string);
  if (classIds.length === 0) {
    return {
      ok: true,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      today,
      cards: [],
      // 학원엔 영어 반이 있는데 내 스코프에 없다 = "내가 담당이 아니다"(설정 문제 아님).
      emptyReason: scopeSet && (allClasses ?? []).length > 0 ? "no-scoped-classes" : "no-classes",
    };
  }

  const admin = createAdminClient();
  const [schedules, lines, teachers] = await Promise.all([
    fetchInChunks<{ class_id: string; day_of_week: DowKey; start_time: string; valid_from: string; valid_to: string | null }>(
      classIds,
      (chunk) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, valid_from, valid_to")
          .in("class_id", chunk)
          .lte("valid_from", weekSunday)
          .or(`valid_to.is.null,valid_to.gte.${weekMonday}`),
    ),
    // 주간 계획 행 — 랜딩 집계용(28반 × 슬롯 × 행이라 1000행 초과 가능 → 페이지네이션, B2)
    fetchAllPagedInChunks<{
      class_id: string;
      plan_date: string;
      slot_start: string;
      textbook: string | null;
      page_range: string | null;
      progress: string | null;
      homework: string | null;
    }>(classIds, (chunk, from, to) =>
      admin
        .from("class_sheet_plan_lines")
        .select("class_id, plan_date, slot_start, textbook, page_range, progress, homework")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .gte("plan_date", weekMonday)
        .lte("plan_date", weekSunday)
        .order("id")
        .range(from, to),
    ),
    fetchInChunks<{ id: string; display_name: string | null }>(
      [...new Set((classes ?? []).map((c) => c.teacher_id as string | null).filter((v): v is string => !!v))],
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
  ]);

  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));
  const schedulesByClass = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const arr = schedulesByClass.get(s.class_id) ?? [];
    arr.push(s);
    schedulesByClass.set(s.class_id, arr);
  }
  const meaningfulKeysByClass = new Map<string, Set<string>>();
  const allKeysByClass = new Map<string, Set<string>>();
  for (const l of lines) {
    const key = `${l.plan_date}|${normalizeSlotTime(l.slot_start)}`;
    const all = allKeysByClass.get(l.class_id) ?? new Set<string>();
    all.add(key);
    allKeysByClass.set(l.class_id, all);
    if (isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.page_range, progress: l.progress, homework: l.homework })) {
      const set = meaningfulKeysByClass.get(l.class_id) ?? new Set<string>();
      set.add(key);
      meaningfulKeysByClass.set(l.class_id, set);
    }
  }

  const cards: SheetLandingCard[] = (classes ?? []).map((c) => {
    const scheduled = scheduledSlotKeySet(
      weekMonday,
      (schedulesByClass.get(c.id as string) ?? []).map((s) => ({
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        validFrom: s.valid_from,
        validTo: s.valid_to,
      })),
    );
    const meaningful = meaningfulKeysByClass.get(c.id as string) ?? new Set<string>();
    const all = allKeysByClass.get(c.id as string) ?? new Set<string>();
    let filled = 0;
    for (const key of scheduled) if (meaningful.has(key)) filled += 1;
    let orphan = 0;
    for (const key of all) if (!scheduled.has(key)) orphan += 1;
    return {
      classId: c.id as string,
      className: c.class_name as string,
      teacherName: c.teacher_id ? (teacherName.get(c.teacher_id as string) ?? null) : null,
      totalSlots: scheduled.size,
      filledSlots: filled,
      orphanSlots: orphan,
    };
  });

  return { ok: true, weekMonday, weekLabel: weekLabel(weekMonday), today, cards, emptyReason: null };
}
