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

/**
 * '수강편집' 필수 헤더(반·enrollmentId)가 colIndex에 있는지 검증 — 없으면 throw.
 * ⚠️ 구글 시트는 자유 편집이라 헤더 셀을 지우거나 오타 내기 쉽다. enrollmentId 열이 사라지면 모든 행이
 *    '신규(앵커 없음)'로 오인돼 현재 DB 전 수강이 삭제+재삽입되는 파괴적 diff가 난다 → 사전 차단.
 */
function assertEditHeaders(colIndex: Record<string, number>): void {
  const missing = ([EDIT_HEADERS[0], EDIT_HEADERS[4]] as const).filter((h) => colIndex[h] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `'수강편집' 시트 헤더가 올바르지 않습니다(${missing.join(", ")} 열 없음). 헤더 행을 지우거나 바꾸지 말고, 다시 내보내(또는 '시트 반영')세요.`,
    );
  }
}

/** 헤더명→값 getter 하나로 ParsedEditRow를 만든다(빈 행이면 null). xlsx·구글시트 경로 공용 단일 소스. */
export function buildEditRow(get: (header: string) => string): ParsedEditRow | null {
  const studentName = get("학생");
  const className = get("반");
  const enrollmentId = get("enrollmentId") || null;
  if (!studentName && !className && !enrollmentId) return null; // 빈 행
  return {
    enrollmentId,
    studentName,
    school: get("학교") || null,
    grade: get("학년") || null,
    className,
  };
}

export function parseEditSheet(wb: ExcelJS.Workbook): ParsedEditRow[] {
  const ws = wb.getWorksheet(EDIT_SHEET_NAME);
  if (!ws) return [];

  const colIndex: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = cellText(cell.value);
    if (h) colIndex[h] = col;
  });
  assertEditHeaders(colIndex);

  const rows: ParsedEditRow[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return; // header
    const built = buildEditRow((header) => {
      const ci = colIndex[header];
      return ci ? cellText(row.getCell(ci).value) : "";
    });
    if (built) rows.push(built);
  });
  return rows;
}

/**
 * 구글 시트 values.get의 2D 문자열 그리드(1행=헤더)를 ParsedEditRow[]로.
 * parseEditSheet와 동일한 헤더명 매핑·빈 행 규칙(buildEditRow 공용)을 dense 배열에 적용.
 */
export function rowsToEditRows(grid: string[][]): ParsedEditRow[] {
  if (grid.length === 0) return [];
  const colIndex: Record<string, number> = {};
  grid[0].forEach((h, i) => {
    const t = (h ?? "").toString().trim();
    if (t) colIndex[t] = i;
  });
  assertEditHeaders(colIndex);
  const out: ParsedEditRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const built = buildEditRow((header) => {
      const ci = colIndex[header];
      return ci === undefined ? "" : (row[ci] ?? "").toString().trim();
    });
    if (built) out.push(built);
  }
  return out;
}
