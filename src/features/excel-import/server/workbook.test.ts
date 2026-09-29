import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readSheetGrid } from "../rows";
import type { ImportIssue, SheetSpec } from "../spec";
import { annotateErrors, buildTemplate, findSheet, loadWorkbook, sheetGrid } from "./workbook";

/** 실제 xlsx 바이트로 한 바퀴 — 서식 만들기 → 저장 → 다시 읽기 → 오류 칸 표시 파일. */
type K = "name" | "phone" | "birth";
const SPEC: SheetSpec<K> = {
  name: "원생",
  columns: [
    { key: "name", header: "이름", required: true },
    { key: "phone", header: "보호자연락처" },
    { key: "birth", header: "생년월일" },
  ],
};

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const back = await loadWorkbook(buf as ArrayBuffer);
  expect(back).not.toBeNull();
  return back!;
}

describe("엑셀 서식 한 바퀴", () => {
  it("서식의 필수 열 제목(끝의 *)을 다시 읽고, 전화번호 앞 0이 살아 있다", async () => {
    const wb = buildTemplate("원생", [{ spec: SPEC, rows: [{ name: "김하늘", phone: "010-1234-5678", birth: "2012-03-05" }] }], ["· 안내"]);
    const back = await roundTrip(wb);
    expect(back.worksheets.map((w) => w.name)).toEqual(["원생", "안내"]);
    const issues: ImportIssue[] = [];
    const read = readSheetGrid(SPEC, sheetGrid(findSheet(back, "원생", true)!), issues)!;
    expect(issues).toEqual([]);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]!.phone("phone")).toBe("010-1234-5678");
    expect(read.rows[0]!.date("birth")).toBe("2012-03-05");
  });

  it("엑셀이 날짜 칸으로 저장한 값도 YYYY-MM-DD로 읽는다", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["이름", "생년월일"]);
    ws.addRow(["김하늘", new Date(Date.UTC(2012, 2, 5))]);
    const back = await roundTrip(wb);
    const issues: ImportIssue[] = [];
    const read = readSheetGrid(SPEC, sheetGrid(findSheet(back, "원생", true)!), issues)!;
    expect(read.rows[0]!.date("birth")).toBe("2012-03-05");
  });

  it("오류 표시 파일 — 틀린 칸이 빨갛고 메모가 달리며 '오류목록' 시트로 열린다", async () => {
    const wb = buildTemplate("원생", [{ spec: SPEC, rows: [{ name: "김하늘", phone: "", birth: "2012-02-30" }] }], []);
    const loaded = await roundTrip(wb);
    const issues: ImportIssue[] = [{ sheet: "원생", row: 2, col: "C", header: "생년월일", value: "2012-02-30", message: "날짜로 읽을 수 없습니다" }];
    const out = await loadWorkbook((await annotateErrors(loaded, issues)).buffer as ArrayBuffer);
    const cell = out!.getWorksheet("원생")!.getCell("C2");
    expect(JSON.stringify(cell.fill)).toContain("FFC7CE");
    expect(JSON.stringify(cell.note)).toContain("날짜로 읽을 수 없습니다");
    const list = out!.getWorksheet("오류목록")!;
    expect(list.getRow(2).getCell(6).value).toBe("날짜로 읽을 수 없습니다");
  });
});
