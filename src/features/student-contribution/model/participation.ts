import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { isAttendedStatus } from "@/lib/calc/attendance";
import { videoHomeworkOutcomes, type AssignedHomework } from "@/features/video-homework/auto-outcomes";
import type { VideoArrival, VideoHomeworkMark } from "@/features/video-homework/types";
import { emptyRaws, type Raws, type Metric } from "./config";

export type AttendanceTarget = { student_id: string; class_id: string; session_date: string; slot_start?: string | null };
export type ContributionAttendance = EffectiveAttendanceRecord & { status: string; seat_label?: string | null };
export type PositiveSignal = { id: string; studentId: string; day: string; source: "parent" | "teacher";
  observed: boolean; cancelled: boolean; sourceCurrent: boolean };
export type ParticipationInput = {
  studentId: string; month: string; today: string; allowLate: boolean;
  /** 수업 일정에서 얻은 정규 대상 칸. 0칸/미입력/보강만 있는 달은 개근을 주지 않는다. */
  targets: readonly AttendanceTarget[]; attendance: readonly ContributionAttendance[];
  assignments: readonly AssignedHomework[]; videos: readonly VideoArrival[]; marks: readonly VideoHomeworkMark[];
  grades: readonly { id: string; studentId: string; day: string; kind: string; subject: string }[];
  signals: readonly PositiveSignal[]; ready: { attendance: boolean; video: boolean; grades: boolean; positive: boolean };
};
const keyOf = (r: AttendanceTarget) => `${r.student_id}\0${r.class_id}\0${r.session_date}\0${r.slot_start ?? ""}`;

/** 모든 활동은 월당 0/1. 입력 수·수업 횟수로 점수가 부풀지 않는다. */
export function monthlyParticipation(input: ParticipationInput): { raws: Raws; unavailable: Metric[]; evidenceIds: string[] } {
  const raws = emptyRaws();
  const unavailable: Metric[] = [];
  const evidenceIds: string[] = [];
  const inMonth = (day: string) => day.startsWith(`${input.month}-`) && day <= input.today;
  const completedMonth = input.month < input.today.slice(0, 7);
  if (!input.ready.attendance) unavailable.push("perfectMonths");
  else if (completedMonth) {
    const targets = [...new Map(input.targets.filter((r) => r.student_id === input.studentId && inMonth(r.session_date)).map((r) => [keyOf(r), r])).values()];
    const effective = effectiveAttendanceRecords(input.attendance.filter((r) => r.student_id === input.studentId && inMonth(r.session_date))).filter((r) => !r.seat_label);
    const matched = (t: AttendanceTarget) => {
      const day = effective.filter((r) => r.class_id === t.class_id && r.session_date === t.session_date);
      if (!t.slot_start) return day;
      // 교시 기록이 하나라도 있으면 미입력 교시를 옛 '하루 전체' 기록으로 덮지 않는다.
      return day.some((r) => r.slot_start) ? day.filter((r) => r.slot_start === t.slot_start) : day;
    };
    if (targets.length && targets.every((t) => {
      const day = matched(t);
      return day.length > 0 && day.every((record) => isAttendedStatus(record.status) && (input.allowLate || record.status !== "late"));
    })) {
      raws.perfectMonths = 1;
      evidenceIds.push(...targets.flatMap((t) => matched(t).map((r) => `attendance:${r.id}`)));
    }
  }
  if (!input.ready.video) unavailable.push("videoMonths");
  else if (completedMonth) {
    const { outcomes } = videoHomeworkOutcomes(input.assignments.filter((a) => a.studentId === input.studentId),
      input.videos.filter((v) => v.studentId === input.studentId), input.today, `${input.month}-01`, input.marks);
    const monthly = outcomes.filter((o) => inMonth(o.homeworkDate));
    if (monthly.length && monthly.every((o) => o.status === "submitted")) {
      raws.videoMonths = 1;
      evidenceIds.push(...monthly.flatMap((o) => o.videoId ? [`video:${o.videoId}`] : []));
    }
  }
  if (!input.ready.grades) unavailable.push("examMonths");
  else {
    const took = input.grades.filter((g) => g.studentId === input.studentId && g.kind === "monthly" && inMonth(g.day));
    if (took.length) { raws.examMonths = 1; evidenceIds.push(...took.map((g) => `grade:${g.id}`)); }
  }
  if (!input.ready.positive) unavailable.push("parentPositiveMonths", "teacherPositiveMonths");
  for (const signal of input.signals) {
    if (signal.studentId !== input.studentId || !inMonth(signal.day) || !signal.observed || signal.cancelled || !signal.sourceCurrent) continue;
    raws[signal.source === "parent" ? "parentPositiveMonths" : "teacherPositiveMonths"] = 1;
    evidenceIds.push(`signal:${signal.id}`);
  }
  return { raws, unavailable, evidenceIds: [...new Set(evidenceIds)] };
}
