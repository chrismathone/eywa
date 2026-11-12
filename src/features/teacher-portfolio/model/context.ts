/**
 * 스냅샷에서 한 번만 만드는 공용 색인 — 담임 이력, 그날 수업이 있는 반·대상 학생, 마감 시각별 기록.
 * 강사마다 다시 훑지 않도록 (반 × 날짜) 단위 결과를 캐시한다.
 */
import { axisSlotFromRow, isSeatSlot, resolveTaughtBy, type AxisSlot, type TeacherAxis } from "@/features/attendance/teacher-axis";
import { buildEmployedOn, buildEvalHomeroomHistory, evalHomeroomOnDate, mergeHomeroomChanges, type ActivityTeacherChange, type Tenure } from "./homeroom-history";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { buildCoverage } from "./coverage";
import { between, dowOf, groupBy, kstDateOf, unique } from "./dates";
import type { PortfolioSnapshot, SnapshotAttendance, SnapshotClass, SnapshotReport } from "./types";

/** 그날 수업이 있고 대상 학생이 있는 반 하나. */
export type ClassDay = {
  c: SnapshotClass;
  day: string;
  students: string[];
  axes: AxisSlot[];
  homeroom: string | null;
  /** 보고서 담당 — 위임이 하나면 그 사람, 겹치면 null. */
  reportOwner: string | null;
  /** 자리(LAB·JJ)를 뺀 교시별 수업 담당. */
  slotTeachers: (string | null)[];
  /** 같은 교시의 시작·끝(`HH:MM:SS`) — 강사 근태의 그날 기준 시각(첫 수업 시작 · 마지막 수업 끝). `slotTeachers`와 같은 차례. */
  slotTimes: { start: string; end: string | null }[];
  axisOf: (slotStart: string | null) => TeacherAxis;
};

export type RecordsAsOf = {
  attendanceByClassDay: Map<string, SnapshotAttendance[]>;
  reportsByStudentDay: Map<string, SnapshotReport[]>;
  coveredDays: Set<string>;
  coverage: ReturnType<typeof buildCoverage>;
};

/**
 * 반·날짜 → 그날 담임(id). 강사평가 전 지표와 시간표 X 겹침(퇴원 담당)이 **이 한 함수**를 쓴다 — 따로 짜면 같은 퇴원이
 * 화면마다 다른 선생님에게 붙는다(원장 2026-10-14). 담임 이력 = 감사로그 전이(반 id가 없으면 반 이름이 하나뿐일 때만 잇는다)
 * + `activity_log`의 담임 변경(감사로그에 안 남는 경로 — `homeroom-history.ts`) · 그날 재직 중이 아닌 강사는 담임이 아니다(입사 전·퇴사 뒤).
 * `teacherChanges`·`tenure`를 안 넘기면(옛 스냅숏) 종전과 같다.
 */
export function buildHomeroomOwner(
  classes: readonly SnapshotClass[], transitions: PortfolioSnapshot["transitions"],
  extra: { teacherChanges?: readonly ActivityTeacherChange[]; tenure?: ReadonlyMap<string, Tenure>; aliases?: ReadonlyMap<string, string> } = {},
) {
  // 지운 옛 계정 id → 지금 계정(같은 사람) — 옛 계정→새 계정 '변경'은 담임 교체가 아니다(`loadTeacherAliases`).
  const same = (id: string | null) => (id ? extra.aliases?.get(id) ?? id : null);
  const classNames = groupBy(classes, (c) => c.class_name);
  const classIdOfLabel = (label: string | null) => {
    const hits = label ? classNames.get(label) : undefined;
    return hits?.length === 1 ? hits[0].id : "";
  };
  const audit = transitions.map((t) => ({
    classId: t.class_id || classIdOfLabel(t.target_label), date: t.date, teacherId: same(t.teacher_id), previousTeacherId: same(t.previous_teacher_id),
  })).filter((t) => t.classId && t.date);
  const activity = (extra.teacherChanges ?? []).map((a) => ({ ...a, oldTeacherId: same(a.oldTeacherId), newTeacherId: same(a.newTeacherId) }));
  const history = buildEvalHomeroomHistory(mergeHomeroomChanges(audit, activity));
  const employed = buildEmployedOn(extra.tenure ?? new Map());
  return (c: SnapshotClass, day: string) => {
    const id = same(evalHomeroomOnDate(history.get(c.id), c.teacher_id, day));
    return id && employed(id, day) ? id : null;
  };
}

/** 스냅숏의 지운 계정 → 지금 계정 표(직렬화된 객체) → Map. */
export function aliasesOf(record: Readonly<Record<string, string>> | undefined): Map<string, string> {
  return new Map(Object.entries(record ?? {}));
}

/** 스냅숏의 재직 정보 → 강사 id → 재직 기간(입사일 · 퇴사일). 둘 다 없는 사람은 넣지 않는다(자르지 않는다). */
export function tenureOf(users: readonly { id: string; hire_date?: string | null; resign_date?: string | null }[]): Map<string, Tenure> {
  return new Map(users.filter((u) => u.hire_date || u.resign_date)
    .map((u) => [u.id, { hireDate: u.hire_date ?? null, resignDate: u.resign_date ?? null }]));
}

export function buildContext(d: PortfolioSnapshot) {
  const tenure = tenureOf(d.users);
  const owner = buildHomeroomOwner(d.classes, d.transitions, { teacherChanges: d.teacherChanges, tenure, aliases: aliasesOf(d.teacherAliases) });
  const employed = buildEmployedOn(tenure);
  const reportOwner = (c: SnapshotClass, day: string) => {
    const active = d.delegations.filter((x) => x.class_id === c.id && between(day, x.from_date, x.to_date));
    return active.length === 1 ? active[0].delegate_user_id : active.length > 1 ? null : owner(c, day);
  };
  const schedules = groupBy(d.schedules, (s) => s.class_id);
  const enrollments = groupBy(d.enrollments, (e) => e.class_id);
  const holidays = new Set(d.settings.holidays.map((h) => h.date));

  const classDayCache = new Map<string, ClassDay[]>();
  function classDays(day: string): ClassDay[] {
    const cached = classDayCache.get(day);
    if (cached) return cached;
    const dow = dowOf(day);
    const out: ClassDay[] = [];
    for (const c of d.classes) {
      if (c.is_makeup_pool || (c.closed_at && c.closed_at < day)) continue;
      const rows = schedules.get(c.id) ?? [];
      const live = rows.filter((s) => s.day_of_week === dow && s.valid_from <= day && (!s.valid_to || s.valid_to >= day));
      if (!live.length) continue;
      const students = unique((enrollments.get(c.id) ?? [])
        .filter((e) => isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred }, day)
          && enrollmentAttendsOnDay(e.attendance_days, dow))
        .map((e) => e.student_id));
      if (!students.length) continue;
      const axes = rows.map(axisSlotFromRow);
      const homeroom = owner(c, day);
      const axisCache = new Map<string, TeacherAxis>();
      const axisOf = (slotStart: string | null) => {
        const key = slotStart ?? "";
        let axis = axisCache.get(key);
        if (!axis) {
          axis = resolveTaughtBy({ homeroomTeacherId: homeroom, slots: axes, date: day, slotStart });
          // 그날 재직 중이 아닌 교시 담당은 지운다(시간표 이관이 교시 담당의 시작일을 앞당겨 적은 줄 — 입사 전 3월부터 유효한 칸 등).
          if (axis.teacherId && !employed(axis.teacherId, day)) axis = { teacherId: null, source: "none" };
          axisCache.set(key, axis);
        }
        return axis;
      };
      const lessons = live.filter((s) => !isSeatSlot(axisSlotFromRow(s)));
      out.push({
        c, day, students, axes, homeroom, reportOwner: reportOwner(c, day),
        slotTeachers: lessons.map((s) => axisOf(s.start_time).teacherId),
        slotTimes: lessons.map((s) => ({ start: s.start_time, end: s.end_time })),
        axisOf,
      });
    }
    classDayCache.set(day, out);
    return out;
  }

  // 마감은 한국 날짜로 끊는다. 입력 시각의 한국 날짜를 한 번만 구해 둔다.
  const recordedOn = new Map(d.attendance.map((r) => [r.id, kstDateOf(r.recorded_at) ?? ""]));
  const reportCreatedOn = new Map(d.reports.map((r) => [r.id, kstDateOf(r.created_at)]));
  const reportsByStudentDay = groupBy(d.reports, (r) => `${r.student_id}|${r.report_date}`);
  /** 출결의 모든 판(고친 판·고치기 전 판) — '본인이 그날 넣었나'는 처음 넣은 판까지 봐야 한다(duties.ts). */
  const attendanceVersionsByClassDay = groupBy(d.attendance, (r) => `${r.class_id}|${r.session_date}`);
  /** 출결 행 → 그 행을 넣거나 고친 사람·날짜(활동 기록). 고칠 때 행이 덮여도 그날 넣은 사실이 여기 남는다. */
  const attendanceTouchesByRow = groupBy(d.attendanceTouches ?? [], (t) => t.row_id);
  const recordsCache = new Map<string, RecordsAsOf>();
  /** `cutoff`(한국 날짜)까지 입력된 기록만 남긴다. 그 뒤의 보충·정정은 지난달 점수를 바꾸지 않는다. */
  function recordsAsOf(cutoff: string): RecordsAsOf {
    const cached = recordsCache.get(cutoff);
    if (cached) return cached;
    const rows = d.attendance.filter((r) => (recordedOn.get(r.id) as string) <= cutoff);
    const superseded = new Set(rows.map((r) => r.supersedes_id).filter(Boolean));
    const latest = new Map<string, SnapshotAttendance>();
    const ordered = rows.filter((r) => !superseded.has(r.id))
      .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at) || a.id.localeCompare(b.id));
    for (const r of ordered) latest.set([r.class_id, r.student_id, r.session_date, r.slot_start || "", r.seat_label || ""].join("|"), r);
    const attendance = [...latest.values()];
    const value: RecordsAsOf = {
      attendanceByClassDay: groupBy(attendance, (r) => `${r.class_id}|${r.session_date}`),
      reportsByStudentDay,
      coveredDays: new Set(d.reports
        .filter((r) => r.covers_date && (reportCreatedOn.get(r.id) ?? "9999") <= cutoff)
        .map((r) => `${r.student_id}|${r.class_id}|${r.covers_date}`)),
      coverage: buildCoverage({
        classes: d.classes, attendance, owner,
        makeupLegacy: d.makeupLegacy.filter((r) => { const done = kstDateOf(r.done_at); return done !== null && done <= cutoff; }),
      }),
    };
    recordsCache.set(cutoff, value);
    return value;
  }

  return { owner, employed, holidays, classDays, recordsAsOf, reportCreatedOn, attendanceVersionsByClassDay, attendanceTouchesByRow };
}
export type PortfolioContext = ReturnType<typeof buildContext>;
