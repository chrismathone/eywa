import { absentClassKeysOf, judgeTodayLessonReports } from "../today-actions";
import { isTestClass } from "./test-class";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { boardKey, classKey, dowOf, sessionDates, type ClassPostDay } from "@/features/report-admin/english-writing";
import { buildHasStudentsOn } from "@/features/report-admin/english-class-presence";
import type { EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import type { WorkClass, WorkReport } from "./teacher-work";

export type WorkSchedule = { class_id: string; day_of_week: string; start_time: string; valid_from: string | null; valid_to: string | null };
export type WorkEnrollment = { class_id: string; student_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null; attendance_days: string[] | null };
export type WorkAttendance = EffectiveAttendanceRecord & { status: string };
export type WorkObligation = { classId: string; studentId: string; date: string; written: boolean; status: string | null;
  /** 쓴 보고서에 영상 과제가 나갔나(영상 숙제 출제율 — 원장 2026-10-19). */ videoHomework?: boolean };
export { isTestClass };

export type UnclassifiedWorkReport = Omit<WorkReport, "classId"> & { subject: string | null; teacherName: string | null };

/** 반 ID가 없던 기록은 당시 수강·과목·강사로 귀속이 하나일 때만 센다. 추정으로 영상 숙제를 만들지는 않는다. */
export function resolveUnclassifiedReports(reports: readonly UnclassifiedWorkReport[], classes: readonly WorkClass[], enrollments: readonly WorkEnrollment[], schedules: readonly WorkSchedule[]): WorkReport[] {
  return reports.flatMap((report) => {
    const date = report.coversDate ?? report.date;
    const enrolled = new Set(enrollments.filter((e) => e.student_id === report.studentId
      && isEnrollmentActiveOn({ startDate: e.start_date ?? "0000-01-01", endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, date)).map((e) => e.class_id));
    let matches = classes.filter((c) => enrolled.has(c.id) && c.reportSource !== "classnote" && c.reportSource !== "none" && !isTestClass(c.name ?? "")
      && (!report.subject || c.subject === report.subject));
    const teacherMatches = report.teacherName ? matches.filter((c) => c.teacherName === report.teacherName) : [];
    if (teacherMatches.length) matches = teacherMatches;
    const scheduled = matches.filter((c) => schedules.some((s) => s.class_id === c.id && s.day_of_week === dowOf(date)
      && (!s.valid_from || s.valid_from <= date) && (!s.valid_to || s.valid_to >= date)));
    if (scheduled.length) matches = scheduled;
    if (!matches.length || new Set(matches.map((c) => `${c.teacherId}:${c.subject}`)).size !== 1) return [];
    return [{ ...report, classId: [...matches].sort((a, b) => a.id.localeCompare(b.id))[0].id, videoHomework: false }];
  });
}

/** 분모는 수업일의 작성 의무다. 미작성, 휴원·반이동, 분리등원, 결석, 대체 작성일을 함께 반영한다. */
export function reportWorkObligations(input: {
  classes: readonly WorkClass[]; schedules: readonly WorkSchedule[]; enrollments: readonly WorkEnrollment[];
  attendance: readonly WorkAttendance[]; reports: readonly WorkReport[]; posts: readonly ClassPostDay[];
  from: string; to: string; nowMinutes: number; holidays: readonly string[];
}): WorkObligation[] {
  const { schedules, enrollments, attendance, reports, from, to, nowMinutes } = input;
  const classes = input.classes.filter((c) => !isTestClass(c.name ?? ""));
  const out: WorkObligation[] = [];
  const group = (c: WorkClass) => `${c.teacherId ?? "unassigned"}:${c.subject}`;
  const groups = new Map<string, WorkClass[]>();
  for (const c of classes.filter((c) => c.reportSource !== "none" && c.reportSource !== "classnote")) groups.set(group(c), [...(groups.get(group(c)) ?? []), c]);
  const activeOn = (classId: string, date: string) => schedules.some((s) => s.class_id === classId && s.day_of_week === dowOf(date)
    && (!s.valid_from || s.valid_from <= date) && (!s.valid_to || s.valid_to >= date)
    && (date !== to || Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5)) <= nowMinutes));
  const dates = sessionDates(from, to, new Set(input.holidays));
  for (const date of dates) {
    const absent = absentClassKeysOf(attendance.filter((a) => a.session_date === date));
    for (const own of groups.values()) {
      const ids = new Set(own.map((c) => c.id));
      const byId = new Map(own.map((c) => [c.id, c]));
      const ownReports = reports.filter((r) => ids.has(r.classId));
      const targets = enrollments.filter((e) => ids.has(e.class_id) && activeOn(e.class_id, date)
        && isEnrollmentActiveOn({ startDate: e.start_date ?? "0000-01-01", endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, date)
        && enrollmentAttendsOnDay(e.attendance_days, dowOf(date)))
        .map((e) => ({ studentId: e.student_id, classId: e.class_id, subject: byId.get(e.class_id)!.subject }));
      const due = judgeTodayLessonReports(targets, absent, ownReports.map((r) => ({ studentId: r.studentId, subject: byId.get(r.classId)!.subject, reportDate: r.date, coversDate: r.coversDate })), date).due;
      const seen = new Set<string>();
      for (const target of due) {
        const report = ownReports.find((r) => r.studentId === target.studentId && r.date === date && target.classIds.includes(r.classId));
        out.push({ classId: report?.classId ?? target.classIds[0]!, studentId: target.studentId, date, written: !!report, status: report?.status ?? null, videoHomework: report?.videoHomework === true });
        seen.add(target.studentId);
      }
      // 보강 등 시간표 밖에서 실제 작성한 보고서도 분모·분자에 함께 포함한다.
      for (const report of ownReports) if (report.date === date && !seen.has(report.studentId)) {
        seen.add(report.studentId);
        out.push({ classId: report.classId, studentId: report.studentId, date, written: true, status: report.status, videoHomework: report.videoHomework === true });
      }
    }
  }
  const external = classes.filter((c) => c.reportSource === "classnote");
  const posted = new Set(input.posts.map((p) => `${boardKey(p.boardName)}:${p.postedOn}`));
  // 그날 받을 학생이 없는 반은 할 일이 아니다 — 작성률 화면(getEnglishTeacherRates)과 같은 판정.
  const hasStudentsOn = buildHasStudentsOn(enrollments);
  for (const cls of external) {
    const key = classKey(cls.name ?? "");
    const unique = !!key && external.filter((c) => classKey(c.name ?? "") === key).length === 1;
    for (const date of dates) if (activeOn(cls.id, date) && hasStudentsOn(cls.id, date)) {
      const written = unique && posted.has(`${key}:${date}`);
      out.push({ classId: cls.id, studentId: "class-post", date, written, status: written ? "success" : null });
    }
  }
  return out;
}
