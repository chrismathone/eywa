import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { EDIT_HEADERS, EDIT_SHEET_NAME, parseEditSheet, rowsToEditRows } from "./parse";

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

  it("필수 헤더(enrollmentId) 누락이면 throw(파괴적 diff 방지)", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(EDIT_SHEET_NAME);
    ws.addRow(["반", "학생", "학교", "학년"]); // enrollmentId 열 없음
    ws.addRow(["DP3", "김민준", "선린중", "중1"]);
    expect(() => parseEditSheet(wb)).toThrow(/헤더가 올바르지 않습니다/);
  });
});

describe("rowsToEditRows (구글 시트 그리드 경로)", () => {
  const header = [...EDIT_HEADERS]; // [반, 학생, 학교, 학년, enrollmentId]

  it("헤더명 기준으로 그리드 행 파싱(xlsx와 동일 결과)", () => {
    const rows = rowsToEditRows([
      header,
      ["DP3", "김민준", "선린중", "중1", "e1"],
      ["DP4", "이서연", "한빛중", "중2", "e2"],
    ]);
    expect(rows).toEqual([
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP4" },
    ]);
  });

  it("enrollmentId 칸이 비거나 누락이면 신규 행(null)", () => {
    const rows = rowsToEditRows([
      header,
      ["DP3", "신규생", "새중", "중1", ""], // 빈 문자열
      ["DP3", "또신규", "새중", "중1"], // 셀 누락(짧은 행)
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].enrollmentId).toBeNull();
    expect(rows[1].enrollmentId).toBeNull();
    expect(rows[1].studentName).toBe("또신규");
  });

  it("완전 빈 행은 스킵, 빈 그리드는 []", () => {
    expect(rowsToEditRows([])).toEqual([]);
    expect(
      rowsToEditRows([header, ["DP3", "김민준", "선린중", "중1", "e1"], ["", "", "", "", ""]]),
    ).toHaveLength(1);
  });

  it("열 순서가 바뀌어도 헤더명으로 매칭 + 공백 trim", () => {
    const rows = rowsToEditRows([
      ["enrollmentId", "학생", "반", "학년", "학교"],
      ["e9 ", " 박지후", "DP5", "중3", "큰중"],
    ]);
    expect(rows[0]).toEqual({
      enrollmentId: "e9",
      studentName: "박지후",
      school: "큰중",
      grade: "중3",
      className: "DP5",
    });
  });

  it("필수 헤더(반) 누락이면 throw", () => {
    expect(() =>
      rowsToEditRows([
        ["학생", "학교", "학년", "enrollmentId"], // 반 열 없음
        ["김민준", "선린중", "중1", "e1"],
      ]),
    ).toThrow(/헤더가 올바르지 않습니다/);
  });
});
