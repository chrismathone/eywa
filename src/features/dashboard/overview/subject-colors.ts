import { programSubjectsOf, subjectGroupOf, type Program } from "@/features/students/program";

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
