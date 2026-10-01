import type {
  ExistingContext,
  ExistingSchedule,
  ParsedScheduleBlock,
  SheetGrid,
  DryRunReport,
  ApplyClassUpdate,
} from "../structure/types";
import type { RosterStudentRef } from "../roster/match-roster";
import type { ImportDiff } from "../types";
import type { ScheduledGroup } from "../../scheduled-groups";
import type { MasterRosterReview } from "./roster-review";

export const MASTER_SHEET_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
export type MasterInput = {
  source: string;
  teacherTab: string;
  rosterTab: string;
  effectiveDate: string;
  maxColumn: string;
  /** Explicit sheet name → existing class. A different name means a rename, preserving history. */
  classBindings: Record<string, string>;
  teacherBindings?: Record<string, string>;
  closeClassIds?: string[];
};
export type MasterIssue = {
  key: string;
  severity: "error" | "confirm" | "warning";
  target: string;
  reason: string;
  fix: string;
  tab?: string;
  cell?: string;
  href?: string;
};
export type MasterClass = ExistingContext["classes"][number] & {
  active: boolean;
  closedAt: string | null;
  track: string | null;
};
export type MasterEnrollment = {
  id: string;
  studentId: string;
  classId: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  isTransferred: boolean;
  attendanceDays: string[] | null;
};
export type MasterContext = {
  classes: MasterClass[];
  teachers: ExistingContext["teachers"];
  classrooms: ExistingContext["classrooms"];
  students: RosterStudentRef[];
  schedules: ExistingSchedule[];
  enrollments: MasterEnrollment[];
  groups: ScheduledGroup[];
  blocks: (ParsedScheduleBlock & {
    id: string;
    validFrom: string;
    validTo: string | null;
  })[];
  attendance: {
    classId: string;
    studentId: string;
    date: string;
    startTime: string | null;
  }[];
  pending: { id: string; date: string; label: string }[];
};
export type ClassMapping = {
  sheetName: string;
  classId: string | null;
  currentName: string | null;
  suggestedId: string | null;
  suggestedName: string | null;
  evidence: string;
  explicit: boolean;
};
export type MasterPlan = {
  report: DryRunReport;
  roster: ImportDiff;
  issues: MasterIssue[];
  mappings: ClassMapping[];
  teacherMappings: {
    sheetName: string;
    header: string;
    teacherId: string | null;
    suggestedId: string | null;
    suggestedName: string | null;
  }[];
  omittedClasses: { id: string; name: string; slots: number }[];
  classUpdates: ApplyClassUpdate[];
  blocks: ParsedScheduleBlock[];
  groups: ScheduledGroup[];
  source: {
    spreadsheetId: string;
    teacherTab: string;
    rosterTab: string;
    teacherGid: number;
    rosterGid: number;
  };
  effectiveDate: string;
};
export type MasterPreview = MasterPlan & {
  hash: string;
  rosterReview: MasterRosterReview;
  classes: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  classrooms: { id: string; name: string }[];
};
export type MasterGrids = { teacher: SheetGrid; roster: SheetGrid };
