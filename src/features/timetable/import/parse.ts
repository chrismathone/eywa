// 업로드된 xlsx의 '수강편집' 시트를 ParsedEditRow[]로 파싱 — 헤더명 기준(열 순서 무관).
// 순수 함수(ExcelJS.Workbook 입력)라 in-memory workbook으로 단위테스트 가능.

import type ExcelJS from "exceljs";
import type { ParsedEditRow } from "./types";

export const EDIT_SHEET_NAME = "수강편집";
/** 시트 헤더(이 순서로 export, 파싱은 헤더명으로). enrollmentId는 수정 금지 앵커. */
export const EDIT_HEADERS = ["반", "학생", "학교", "학년", "enrollmentId"] as const;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).trim();
}

export function parseEditSheet(wb: ExcelJS.Workbook): ParsedEditRow[] {
  const ws = wb.getWorksheet(EDIT_SHEET_NAME);
  if (!ws) return [];

  const colIndex: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = cellText(cell.value);
    if (h) colIndex[h] = col;
  });

  const get = (row: ExcelJS.Row, header: string): string => {
    const ci = colIndex[header];
    return ci ? cellText(row.getCell(ci).value) : "";
  };

  const rows: ParsedEditRow[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return; // header
    const studentName = get(row, "학생");
    const className = get(row, "반");
    const enrollmentId = get(row, "enrollmentId") || null;
    if (!studentName && !className && !enrollmentId) return; // 빈 행
    rows.push({
      enrollmentId,
      studentName,
      school: get(row, "학교") || null,
      grade: get(row, "학년") || null,
      className,
    });
  });
  return rows;
}
