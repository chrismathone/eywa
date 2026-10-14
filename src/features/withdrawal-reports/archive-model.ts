import type { ImportedReport } from "./source-parser";
export type ArchiveRow = {
  id: string; spreadsheet_id: string; sheet_id: number; sheet_title: string; source_range: string;
  student_name: string; school_grade: string; class_name: string; subject: string | null; exit_date: string | null;
  raw_exit_date: string; teacher_name: string; mapped_student_id: string | null; mapping_kind: "auto" | "manual" | "unmapped"; revision: number;
};
export type ArchiveDetail = ArchiveRow & { fields: Record<string, string>; signatures: ImportedReport["signatures"]; raw_grid: string[][] };
export type ArchiveStudent = { id: string; name: string; school: string | null; grade: string | null; status: string };
