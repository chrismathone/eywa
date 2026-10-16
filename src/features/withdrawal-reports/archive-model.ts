import type { ImportedReport } from "./source-parser";
export type ArchiveRow = {
  id: string; spreadsheet_id: string; sheet_id: number; sheet_title: string; source_range: string;
  student_name: string; school_grade: string; class_name: string; subject: string | null; exit_date: string | null;
  raw_exit_date: string; teacher_name: string; mapped_student_id: string | null; mapping_kind: "auto" | "manual" | "unmapped"; revision: number;
  /** 목록 조회만 싣는 원문 사유 글·상세 사유(`fields`에서 뽑은 칸 — 상세 화면의 `select("*")`엔 없다). */
  reason_raw?: string | null; detail_raw?: string | null;
};
export type ArchiveDetail = ArchiveRow & { fields: Record<string, string>; signatures: ImportedReport["signatures"]; raw_grid: string[][] };
export type ArchiveStudent = { id: string; name: string; school: string | null; grade: string | null; status: string };
