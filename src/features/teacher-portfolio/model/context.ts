/**
 * 스냅샷에서 한 번만 만드는 공용 색인 — 담임 이력, 그날 수업이 있는 반·대상 학생, 마감 시각별 기록.
 * 강사마다 다시 훑지 않도록 (반 × 날짜) 단위 결과를 캐시한다.
 */
import { axisSlotFromRow, isSeatSlot, resolveTaughtBy, type AxisSlot, type TeacherAxis } from "@/features/attendance/teacher-axis";
import { buildHomeroomHistoryIndex, homeroomTeacherOnDate } from "@/features/classes/teacher-as-of";
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
 * 화면마다 다른 선생님에게 붙는다(원장 2026-10-14). 담임 이력 = 감사로그 전이, 반 id가 없으면 반 이름이 하나뿐일 때만 잇는다.
 */
export function buildHomeroomOwner(classes: readonly SnapshotClass[], transitions: PortfolioSnapshot["transitions"]) {
  const classNames = groupBy(classes, (c) => c.class_name);
  const classIdOfLabel = (label: string | null) => {
    const hits = label ? classNames.get(label) : undefined;
    return hits?.length === 1 ? hits[0].id : "";
  };
  const history = buildHomeroomHistoryIndex(transitions.map((t) => ({
    classId: t.class_id || classIdOfLabel(t.target_label), date: t.date, teacherName: null,
    teacherId: t.teacher_id, previousTeacherId: t.previous_teacher_id,
  })));
  return (c: SnapshotClass, day: string) => homeroomTeacherOnDate(history.get(c.id), c.teacher_id, day);
}

export function buildContext(d: PortfolioSnapshot) {
  const owner = buildHomeroomOwner(d.classes, d.transitions);
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
        if (!axis) axisCache.set(key, (axis = resolveTaughtBy({ homeroomTeacherId: homeroom, slots: axes, date: day, slotStart })));
        return axis;
      };
      out.push({
        c, day, students, axes, homeroom, reportOwner: reportOwner(c, day),
        slotTeachers: live.filter((s) => !isSeatSlot(axisSlotFromRow(s))).map((s) => axisOf(s.start_time).teacherId),
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

  return { owner, holidays, classDays, recordsAsOf, reportCreatedOn, attendanceVersionsByClassDay, attendanceTouchesByRow };
}
export type PortfolioContext = ReturnType<typeof buildContext>;
