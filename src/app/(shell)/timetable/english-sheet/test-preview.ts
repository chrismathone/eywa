import type {
  MasterIssue,
  MasterPreview,
} from "@/features/timetable/import/master/types";
export function preview(issues: MasterIssue[] = []): MasterPreview {
  return {
    attendanceMigration: { moves: [], retainedCells: 0 },
    hash: "a".repeat(64),
    effectiveDate: "2026-10-01",
    source: {
      spreadsheetId: "sheet",
      teacherTab: "강사별(10월)",
      rosterTab: " 통합(10월)",
      teacherGid: 1,
      rosterGid: 2,
    },
    report: {
      slotsParsed: 1,
      targetSchedules: 1,
      entitiesToCreate: { teachers: [], classes: [], rooms: [] },
      matched: { classes: 1, teachers: 1, rooms: 1 },
      plan: { create: 1, update: 0, keep: 0, remove: 0 },
      planItems: [],
      conflicts: [],
      warnings: [],
      hash: "x",
    },
    roster: { moves: [], adds: [], removes: [], unchanged: 0, warnings: [] },
    issues,
    mappings: [],
    rosterReview: { sheet: [], existing: [] },
    teacherMappings: [],
    omittedClasses: [],
    classUpdates: [],
    blocks: [],
    groups: [],
    classes: [],
    teachers: [],
    classrooms: [],
  };
}
