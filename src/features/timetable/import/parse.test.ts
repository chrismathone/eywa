import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { EDIT_HEADERS, EDIT_SHEET_NAME, parseEditSheet } from "./parse";

function buildWb(rows: (string | null)[][]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(EDIT_SHEET_NAME);
  ws.addRow([...EDIT_HEADERS]);
  for (const r of rows) ws.addRow(r);
  return wb;
}

describe("parseEditSheet", () => {
  it("헤더명 기준으로 행 파싱", async () => {
    const wb = buildWb([
      ["DP3", "김민준", "선린중", "중1", "e1"],
      ["DP4", "이서연", "한빛중", "중2", "e2"],
    ]);
    const rows = parseEditSheet(wb);
    expect(rows).toEqual([
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP4" },
    ]);
  });

  it("enrollmentId 비면 신규 행(null)", () => {
    const wb = buildWb([["DP3", "신규생", "새중", "중1", null]]);
    const rows = parseEditSheet(wb);
    expect(rows[0].enrollmentId).toBeNull();
    expect(rows[0].studentName).toBe("신규생");
  });

  it("완전 빈 행은 스킵", () => {
    const wb = buildWb([
      ["DP3", "김민준", "선린중", "중1", "e1"],
      [null, null, null, null, null],
    ]);
    expect(parseEditSheet(wb)).toHaveLength(1);
  });

  it("시트 없으면 빈 배열", () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("다른시트");
    expect(parseEditSheet(wb)).toEqual([]);
  });

  it("열 순서가 바뀌어도 헤더명으로 매칭", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(EDIT_SHEET_NAME);
    ws.addRow(["enrollmentId", "학생", "반", "학년", "학교"]); // 뒤섞은 순서
    ws.addRow(["e9", "박지후", "DP5", "중3", "큰중"]);
    const rows = parseEditSheet(wb);
    expect(rows[0]).toEqual({
      enrollmentId: "e9",
      studentName: "박지후",
      school: "큰중",
      grade: "중3",
      className: "DP5",
    });
  });
});
