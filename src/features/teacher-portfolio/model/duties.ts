/**
 * 한 강사·한 달의 수업 의무 — 누가 그 수업을 맡았는지는 시간표로 판정한다(입력한 사람이 아니다).
 *
 * 보고서는 학생·수업일마다 한 번(교시 수로 불리지 않는다), 출결은 학생·반·수업일마다 한 번이다.
 * 결석·휴원일·보고서 제외 반은 보고 대상에서 뺀다.
 * 🔴 **본인이 수업 당일(한국 시간)에 쓴 것만 작성**(원장 2026-10-14 *"당일 수업을 당일에 작성하지 않으면 점수에서는
 *    미작성으로 취급"* · *"대리 이런건 됐고, 오로지 작성/미작성만"* · *"본인의 작성/미작성만 카운트할것"*) —
 *    다른 사람이 쓴 것(대리)·다음 날 이후에 쓴 것·작성자를 모르는 것은 전부 미작성이다. 출결도 같다.
 */
import { isReportTrackedSubject } from "@/features/dashboard/report-subjects";
import { subjectGroupOf } from "@/features/students/program";
import type { PortfolioContext, RecordsAsOf } from "./context";
import { kstDateOf } from "./dates";
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
  /** 결석 판정에 쓰는 출결 기록의 기준 날짜(한국) — 작성 인정은 수업 당일로 따로 판정한다. */
  cutoff: string;
  user: SnapshotUser;
  days: readonly string[];
}): TeacherDuties {
  const { d, ctx, records, user } = input;
  const reportTargets = new Map<string, ReportTarget>();
  const attendanceTargets = new Map<string, AttendanceRow>();
  const classIds = new Set<string>();
  let untracked = 0;
  const isEnglish = (subject: string) => subjectGroupOf(subject, d.settings.subjects) === "english";

  for (const day of input.days) for (const cd of ctx.classDays(day)) {
    const { c } = cd;
    const teachesSlot = cd.slotTeachers.includes(user.id);
    if (cd.homeroom === user.id || teachesSlot) classIds.add(c.id);
    if (ctx.holidays.has(day)) continue;
    const classRecords = records.attendanceByClassDay.get(`${c.id}|${day}`) ?? [];
    const lessonRecords = (studentId: string) =>
      classRecords.filter((r) => r.student_id === studentId && !r.seat_label && r.recorded_via !== SEAT);

    // 출결 = 그 학생·그날 출결 행을 본인이 그날 안에 넣거나 고친 적이 있으면 작성. 출결은 고칠 때 같은 행을 덮어써
    // 입력자·시각이 바뀌므로(다음 날 누가 고쳐도) 활동 기록(입력·수정)으로 본다 — 기록이 없는 행만 지금 입력자·시각으로.
    if (teachesSlot) for (const studentId of cd.students) {
      const versions = (ctx.attendanceVersionsByClassDay.get(`${c.id}|${day}`) ?? [])
        .filter((r) => r.student_id === studentId && !r.seat_label && r.recorded_via !== SEAT);
      const done = versions.some((r) => (r.recorded_by === user.id && (kstDateOf(r.recorded_at) ?? "9999") <= day)
        || (ctx.attendanceTouchesByRow.get(r.id) ?? []).some((t) => t.actor_id === user.id && t.day <= day));
      attendanceTargets.set(`${c.id}|${studentId}|${day}`, { day, studentId, className: c.class_name, done, ambiguous: false });
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

  // 보고서 = 그 수업일·그 반의 보고서를 본인이 그날 만들었으면 작성. 나머지는 전부 미작성(대리·늦게·작성자 모름).
  const reportCells: ReportCell[] = [...reportTargets.values()].map((t) => {
    const sameDay = records.reportsByStudentDay.get(`${t.studentId}|${t.day}`) ?? [];
    const written = sameDay.some((r) => !r.makeup && r.class_id !== null && t.classes.has(r.class_id) && r.created_by === user.id
      && (ctx.reportCreatedOn.get(r.id) ?? "9999") <= t.day);
    return { day: t.day, studentId: t.studentId, className: [...t.classNames].join(", "), state: written ? "own" : "missing" };
  });

  return { classIds, attendance: [...attendanceTargets.values()], reportCells, untracked, unknownAttendance: 0 };
}
