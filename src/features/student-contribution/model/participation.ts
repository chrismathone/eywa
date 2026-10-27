import type { EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { completedAttendanceWeeks } from "./weekly-attendance";
import { videoHomeworkOutcomes, type AssignedHomework } from "@/features/video-homework/auto-outcomes";
import type { VideoArrival, VideoHomeworkMark } from "@/features/video-homework/types";
import { emptyRaws, type Raws, type Metric } from "./config";

export type AttendanceTarget = { student_id: string; class_id: string; session_date: string; slot_start?: string | null };
export type ContributionAttendance = EffectiveAttendanceRecord & { status: string; seat_label?: string | null };
export type PositiveSignal = { id: string; studentId: string; day: string; source: "parent" | "teacher";
  observed: boolean; cancelled: boolean; sourceCurrent: boolean };
export type ParticipationInput = {
  studentId: string; month: string; today: string; allowLate: boolean;
  /** 수업 일정에서 얻은 정규 대상 칸. 0칸/미입력/보강만 있는 주는 개근을 주지 않는다. */
  targets: readonly AttendanceTarget[]; attendance: readonly ContributionAttendance[];
  assignments: readonly AssignedHomework[]; videos: readonly VideoArrival[]; marks: readonly VideoHomeworkMark[];
  grades: readonly { id: string; studentId: string; day: string; kind: string; subject: string }[];
  signals: readonly PositiveSignal[]; ready: { attendance: boolean; video: boolean; grades: boolean; positive: boolean | { parent: boolean; teacher: boolean } };
};
/** 출석은 주별, 영상은 숙제별로 인정하며 나머지 활동은 월별 0/1을 유지한다. */
export function monthlyParticipation(input: ParticipationInput): { raws: Raws; unavailable: Metric[]; evidenceIds: string[] } {
  const raws = emptyRaws();
  const unavailable: Metric[] = [];
  const evidenceIds: string[] = [];
  const inMonth = (day: string) => day.startsWith(`${input.month}-`) && day <= input.today;
  if (!input.ready.attendance) unavailable.push("perfectWeeks");
  else {
    const weeks = completedAttendanceWeeks(input);
    raws.perfectWeeks = weeks.length;
    evidenceIds.push(...weeks.flatMap(w => w.evidenceIds));
  }
  if (!input.ready.video) unavailable.push("videoAssignments");
  else {
    const { outcomes } = videoHomeworkOutcomes(input.assignments.filter(a => a.studentId === input.studentId),
      input.videos.filter(v => v.studentId === input.studentId), input.today, "2026-01-01", input.marks.filter(m => m.studentId === input.studentId));
    const completed = outcomes.filter(o => inMonth(o.homeworkDate) && o.status === "submitted" && o.videoId);
    raws.videoAssignments = completed.length;
    evidenceIds.push(...completed.map(o => `video:${o.videoId}`));
  }
  if (!input.ready.grades) unavailable.push("examMonths");
  else {
    const took = input.grades.filter((g) => g.studentId === input.studentId && g.kind === "monthly" && inMonth(g.day));
    if (took.length) { raws.examMonths = 1; evidenceIds.push(...took.map((g) => `grade:${g.id}`)); }
  }
  const positive = typeof input.ready.positive === "boolean" ? { parent: input.ready.positive, teacher: input.ready.positive } : input.ready.positive;
  if (!positive.parent) unavailable.push("parentPositiveMonths");
  if (!positive.teacher) unavailable.push("teacherPositiveMonths");
  for (const signal of input.signals) {
    if (signal.studentId !== input.studentId || !inMonth(signal.day) || !signal.observed || signal.cancelled || !signal.sourceCurrent) continue;
    raws[signal.source === "parent" ? "parentPositiveMonths" : "teacherPositiveMonths"] = 1;
    evidenceIds.push(`signal:${signal.id}`);
  }
  return { raws, unavailable, evidenceIds: [...new Set(evidenceIds)] };
}
