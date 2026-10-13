/**
 * 한 강사·한 달의 수업 의무 — 누가 그 수업을 맡았는지는 시간표로 판정한다(입력한 사람이 아니다).
 *
 * 보고서는 학생·수업일마다 한 번(교시 수로 불리지 않는다), 출결은 학생·반·수업일마다 한 번이다.
 * 결석·휴원일·보고서 제외 반은 보고 대상에서 빼고, 작성자나 담당 교시를 정말 가릴 수 없으면
 * 0점이 아니라 산출불가로 남긴다.
 */
import { isReportTrackedSubject } from "@/features/dashboard/report-subjects";
import { subjectGroupOf } from "@/features/students/program";
import type { PortfolioContext, RecordsAsOf } from "./context";
import type { AttendanceRow, PortfolioSnapshot, ReportCell, SnapshotUser } from "./types";

type ReportTarget = { studentId: string; day: string; classes: Set<string>; classNames: Set<string> };
export type TeacherDuties = {
  classIds: Set<string>;
  attendance: AttendanceRow[];
  reportCells: ReportCell[];
  /** 앱 밖에서 보고하는 과목·작성 면제 강사의 대상 — 작성 여부를 확인할 수 없다. */
  untracked: number;
  unknownAttendance: number;
};

const SEAT = "seat";

export function teacherDuties(input: {
  d: PortfolioSnapshot;
  ctx: PortfolioContext;
  records: RecordsAsOf;
  /** 이 날짜(한국)까지 작성된 보고서만 인정한다. */
  cutoff: string;
  user: SnapshotUser;
  days: readonly string[];
}): TeacherDuties {
  const { d, ctx, records, cutoff, user } = input;
  const reportTargets = new Map<string, ReportTarget>();
  const attendanceTargets = new Map<string, AttendanceRow>();
  const classIds = new Set<string>();
  let untracked = 0;
  let unknownAttendance = 0;
  const isEnglish = (subject: string) => subjectGroupOf(subject, d.settings.subjects) === "english";

  for (const day of input.days) for (const cd of ctx.classDays(day)) {
    const { c } = cd;
    const teachesSlot = cd.slotTeachers.includes(user.id);
    if (cd.homeroom === user.id || teachesSlot) classIds.add(c.id);
    if (ctx.holidays.has(day)) continue;
    const classRecords = records.attendanceByClassDay.get(`${c.id}|${day}`) ?? [];
    const lessonRecords = (studentId: string) =>
      classRecords.filter((r) => r.student_id === studentId && !r.seat_label && r.recorded_via !== SEAT);

    if (teachesSlot) for (const studentId of cd.students) {
      const relevant = lessonRecords(studentId);
      const mine = relevant.filter((r) => (r.taught_by ? r.taught_by === user.id : cd.axisOf(r.slot_start).teacherId === user.id));
      const ambiguous = relevant.some((r) => !r.taught_by && cd.axisOf(r.slot_start).source === "ambiguous") && !mine.length;
      if (ambiguous) unknownAttendance++;
      attendanceTargets.set(`${c.id}|${studentId}|${day}`, { day, studentId, className: c.class_name, done: mine.length > 0, ambiguous });
    }

    if (cd.reportOwner !== user.id || c.report_optout) continue;
    // 영어는 앱에 학생별 보고서를 쓰지 않아도 대상으로 세고, 보고서가 없으면 0점이다(원장 결정).
    // 다른 과목이 앱 보고 대상이 아니거나 강사가 작성 면제면 작성 여부를 알 수 없다.
    // 보고 대상 과목은 운영실과 같은 판정이다 — 목록이 비면 전부 센다(조용히 산출불가가 되지 않게).
    if (!isEnglish(c.subject)
      && (!isReportTrackedSubject(c.subject, d.settings.report_subjects) || d.settings.report_exempt.includes(user.display_name))) {
      untracked += cd.students.length;
      continue;
    }
    for (const studentId of cd.students) {
      const own = lessonRecords(studentId);
      if (own.length && own.every((r) => r.status === "absent" || r.status === "excused")) continue;
      if (records.coveredDays.has(`${studentId}|${c.id}|${day}`)) continue;
      const key = `${studentId}|${day}`;
      const target = reportTargets.get(key) ?? { studentId, day, classes: new Set<string>(), classNames: new Set<string>() };
      target.classes.add(c.id);
      target.classNames.add(c.class_name);
      reportTargets.set(key, target);
    }
  }

  const reportCells: ReportCell[] = [...reportTargets.values()].map((t) => {
    const sameDay = records.reportsByStudentDay.get(`${t.studentId}|${t.day}`) ?? [];
    const all = sameDay.filter((r) => !r.makeup && r.class_id !== null && t.classes.has(r.class_id));
    const createdBy = (id: string) => ctx.reportCreatedOn.get(id) ?? null;
    const inTime = all.filter((r) => { const on = createdBy(r.id); return on !== null && on <= cutoff; });
    const own = inTime.some((r) => r.created_by === user.id);
    // 작성 시각·작성자·반이 비어 있는 보고서는 누구의 실적인지 가릴 수 없다.
    const unknown = all.some((r) => !r.created_at) || inTime.some((r) => !r.created_by)
      || (!inTime.length && sameDay.some((r) => !r.class_id && !r.makeup && (createdBy(r.id) ?? "9999") <= cutoff));
    const state = own ? "own" : unknown ? "unknown" : inTime.length ? "proxy" : all.length ? "late" : "missing";
    return { day: t.day, studentId: t.studentId, className: [...t.classNames].join(", "), state };
  });

  return { classIds, attendance: [...attendanceTargets.values()], reportCells, untracked, unknownAttendance };
}
