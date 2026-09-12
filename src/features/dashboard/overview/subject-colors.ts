import { programSubjectsOf, subjectGroupOf, type Program } from "@/features/students/program";
import type { StaffSubjectGroup } from "./staff-subjects";

/** Dashboard subject colors: blue math, red English, warm violet English + math. */
export const DASHBOARD_SUBJECT_COLORS = {
  math: "#1267D5",
  english: "#D23C48",
  both: "#9B2EB7",
  unenrolled: "#47505C",
  other: "#687787",
} as const;

export function dashboardProgramColor(program: Program) {
  return program === "math" ? DASHBOARD_SUBJECT_COLORS.math : DASHBOARD_SUBJECT_COLORS.english;
}

/** Display only: use the same subject grouping as enrolled composition, never array order. */
export function dashboardSubjectColor(subject: string, labels: Readonly<Record<string, string>>) {
  const group = subjectGroupOf(subject, programSubjectsOf(labels));
  return group === "math" ? DASHBOARD_SUBJECT_COLORS.math
    : group === "english" ? DASHBOARD_SUBJECT_COLORS.english
      : DASHBOARD_SUBJECT_COLORS.other;
}

/** Two math courses are still math; violet specifically means English AND math. */
export function dashboardCombinationColor(subjects: readonly string[], labels: Readonly<Record<string, string>>) {
  const settings = programSubjectsOf(labels);
  const groups = new Set(subjects.map((subject) => subjectGroupOf(subject, settings)));
  if (groups.has("english") && groups.has("math")) return DASHBOARD_SUBJECT_COLORS.both;
  if (groups.has("math")) return DASHBOARD_SUBJECT_COLORS.math;
  if (groups.has("english")) return DASHBOARD_SUBJECT_COLORS.english;
  return DASHBOARD_SUBJECT_COLORS.other;
}

/**
 * 직원 구성 막대의 과목 묶음 — 영어·수학·둘 다는 학년별 재원생 막대(`STUDENT_SEGMENTS`)와 **같은 색·같은 순서**
 * (빨강 → 보라 → 파랑), 과목 없음은 '미수강'과 같은 진한 회색(원장 2026-09-12 "과목 없는 강사는 그냥 진한 회색").
 * 순서가 범례·조각 순서다.
 */
export const STAFF_SUBJECT_LEGEND: readonly { key: StaffSubjectGroup; label: string; color: string }[] = [
  { key: "english", label: "영어", color: DASHBOARD_SUBJECT_COLORS.english },
  { key: "both", label: "영어+수학", color: DASHBOARD_SUBJECT_COLORS.both },
  { key: "math", label: "수학", color: DASHBOARD_SUBJECT_COLORS.math },
  { key: "other", label: "기타 과목", color: DASHBOARD_SUBJECT_COLORS.other },
  { key: "none", label: "과목 없음", color: DASHBOARD_SUBJECT_COLORS.unenrolled },
];
