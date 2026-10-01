import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { norm } from "../match";
import {
  matchRosterStudent,
  type RosterMatch,
  type RosterStudentRef,
} from "../roster/match-roster";
import {
  parseIntegratedRoster,
  type RosterEntry,
} from "../roster/parse-roster";
import type { MasterContext, MasterGrids, MasterInput } from "./types";

/** Matching still considers suffix siblings. Only the redundant human confirmation is suppressed. */
export function needsRosterConfirmation(
  name: string,
  match: RosterMatch,
  students: readonly RosterStudentRef[],
) {
  if (match.status !== "ok") return false;
  const exact = students.filter((s) => norm(s.name) === norm(name));
  return exact.length !== 1 || exact[0]!.studentId !== match.studentId;
}

export function rosterMatchReason(
  match: Extract<RosterMatch, { status: "ok" }>,
) {
  const labels = {
    unique: "이름 후보가 한 명",
    "school+grade": "학교·학년 일치",
    school: "학교 일치",
    grade: "학년 일치",
    enrolled: "후보 중 재원 학생이 한 명",
    literal: "이름 표기 일치",
  };
  return labels[match.basis];
}

export type SheetRosterMember = RosterEntry & {
  student: RosterStudentRef | null;
  candidates: RosterStudentRef[];
  needsConfirmation: boolean;
};
export type MasterRosterReview = {
  sheet: {
    sheetName: string;
    declared: number;
    members: SheetRosterMember[];
  }[];
  existing: {
    classId: string;
    className: string;
    members: (RosterStudentRef & { onHold: boolean })[];
  }[];
};

/** Uses the same date/transfer/hold rules and tenant-scoped snapshot as the apply planner. */
export function buildRosterReview(
  input: MasterInput,
  grids: MasterGrids,
  ctx: MasterContext,
): MasterRosterReview {
  const students = new Map(ctx.students.map((s) => [s.studentId, s]));
  const existing: MasterRosterReview["existing"] = ctx.classes
    .filter(
      (c) =>
        c.subject === "english" &&
        c.active &&
        (!c.closedAt || c.closedAt >= input.effectiveDate),
    )
    .map((c) => ({ classId: c.id, className: c.className, members: [] }));
  const classes = new Map(existing.map((c) => [c.classId, c]));
  for (const e of ctx.enrollments) {
    const klass = classes.get(e.classId);
    const student = students.get(e.studentId);
    if (!klass || !student || !isEnrollmentOnRosterOn(e, input.effectiveDate))
      continue;
    const previous = klass.members.find((s) => s.studentId === e.studentId);
    if (previous) previous.onHold ||= e.onHold;
    else klass.members.push({ ...student, onHold: e.onHold });
  }
  for (const c of existing)
    c.members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return {
    existing,
    sheet: parseIntegratedRoster(grids.roster.cells).blocks.map((block) => ({
      sheetName: block.className,
      declared: block.declared,
      members: block.entries.map((entry) => {
        const match = matchRosterStudent(
          entry.name,
          entry.school,
          entry.grade,
          ctx.students,
        );
        return {
          ...entry,
          student:
            match.status === "ok" ? students.get(match.studentId)! : null,
          candidates: match.status === "ambiguous" ? match.candidates : [],
          needsConfirmation: needsRosterConfirmation(
            entry.name,
            match,
            ctx.students,
          ),
        };
      }),
    })),
  };
}

/** Identity is student ID, never display name; unresolved rows stay visible. */
export function compareRosterMembers(
  sheet: readonly SheetRosterMember[],
  existing: MasterRosterReview["existing"][number]["members"],
) {
  const sheetIds = new Set(
    sheet.flatMap((s) => (s.student ? [s.student.studentId] : [])),
  );
  const existingIds = new Set(existing.map((s) => s.studentId));
  return {
    common: new Set([...sheetIds].filter((id) => existingIds.has(id))),
    sheetOnly: new Set([...sheetIds].filter((id) => !existingIds.has(id))),
    existingOnly: existing.filter((s) => !sheetIds.has(s.studentId)),
    unresolved: sheet.filter((s) => !s.student).length,
  };
}
