// 테스트 재료 — **진짜 익스포터**로 워크북을 만들고, 구글 시트가 돌려주는 모양(글자 격자 + 병합)으로 바꾼다.
// 손으로 그린 격자를 쓰지 않는 이유: 익스포터 배치가 바뀌면 이 테스트가 먼저 깨져야 한다(왕복 가드).

import ExcelJS from "exceljs";
import { assembleMathParams } from "@/features/exports/math-timetable/assemble";
import { exportMathTimetableToExcel } from "@/features/exports/math-timetable/exporter";
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";
import type { SheetGridMerge } from "../structure/types";
import { META_TAB_NAME } from "./parse-meta";
import type { ExportedClass } from "./schedule-diff";
import type { MathGridInput } from "./types";

export const MONDAY = new Date(2026, 5, 22); // 2026-06-22(월)

export function student(id: string, name: string, over: Partial<StudentLine> = {}): StudentLine {
  return { studentId: id, name, school: "옥산초", grade: "초5", status: "active", ...over } as StudentLine;
}

interface ClassSpec {
  id: string;
  name: string;
  teacher: string;
  room: string;
  /** [요일, 시작시각] — 평일 16:20 = 2-1, 17:15 = 2-2 … */
  slots: [string, string][];
  students: StudentLine[];
}

export function slotsOf(spec: ClassSpec): ScheduleSlotWithStudents[] {
  return spec.slots.map(
    ([dayOfWeek, startTime], i) =>
      ({
        id: `${spec.id}-${i}`,
        classId: spec.id,
        className: spec.name,
        subject: "math",
        dayOfWeek,
        startTime: `${startTime}:00`,
        endTime: `${startTime}:00`,
        teacherName: spec.teacher,
        classroomName: spec.room,
        studentCount: spec.students.length,
        slotTeacherLabel: null,
        slotRoomLabel: null,
        classBgColor: null,
        classTextColor: null,
        students: spec.students,
      }) as unknown as ScheduleSlotWithStudents,
  );
}

function decodeCell(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** ExcelJS 워크시트 → 구글 시트 읽기 결과 모양. 병합 칸은 왼쪽 위에만 글자가 남는다. */
export function worksheetToGrid(ws: ExcelJS.Worksheet): MathGridInput {
  const cells: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = ws.getCell(r, c);
      const slave = cell.isMerged && cell.master.address !== cell.address;
      row.push(slave || cell.value == null ? "" : String(cell.value));
    }
    cells.push(row);
  }
  const merges: SheetGridMerge[] = ((ws.model as { merges?: string[] }).merges ?? []).map((range) => {
    const [a, b] = range.split(":");
    const from = decodeCell(a!);
    const to = decodeCell(b ?? a!);
    return {
      startRowIndex: from.row,
      endRowIndex: to.row + 1,
      startColumnIndex: from.col,
      endColumnIndex: to.col + 1,
    };
  });
  return { cells, merges };
}

/** 반 목록 → 시트로 보낸 직후의 격자 + `_meta` 행 + 익스포터가 그린 반 목록(배치 비교의 상대). */
export async function exportToSheet(
  specs: ClassSpec[],
): Promise<{ grid: MathGridInput; meta: string[][]; exported: ExportedClass[] }> {
  const params = assembleMathParams(specs.flatMap(slotsOf), { referenceMonday: MONDAY });
  const buffer = (await exportMathTimetableToExcel({ ...params, returnBufferOnly: true })) as ArrayBuffer;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const metaWs = wb.getWorksheet(META_TAB_NAME)!;
  const meta: string[][] = [];
  metaWs.eachRow({ includeEmpty: true }, (row) => {
    const values = (row.values as unknown[]).slice(1);
    meta.push(values.map((v) => (v == null ? "" : String(v))));
  });
  const main = wb.getWorksheet(meta[1]![4]!)!;
  return { grid: worksheetToGrid(main), meta, exported: params.filteredClasses };
}

/** 열 하나를 끼운다 — 그 자리를 가로지르는 병합은 늘어나고 오른쪽 병합은 한 칸씩 밀린다(구글 시트와 같은 규칙). */
export function insertColumn(grid: MathGridInput, at: number): MathGridInput {
  return {
    cells: grid.cells.map((row) => [...row.slice(0, at), "", ...row.slice(at)]),
    merges: grid.merges.map((m) => ({
      ...m,
      startColumnIndex: m.startColumnIndex >= at ? m.startColumnIndex + 1 : m.startColumnIndex,
      endColumnIndex: m.endColumnIndex > at ? m.endColumnIndex + 1 : m.endColumnIndex,
    })),
  };
}

/** 행 하나를 끼운다 — 그 자리를 가로지르는 세로 병합은 늘어나고 아래 병합은 한 줄씩 밀린다. */
export function insertRow(grid: MathGridInput, at: number): MathGridInput {
  const width = Math.max(0, ...grid.cells.map((row) => row.length));
  return {
    cells: [...grid.cells.slice(0, at), Array.from({ length: width }, () => ""), ...grid.cells.slice(at)],
    merges: grid.merges.map((m) => ({
      ...m,
      startRowIndex: m.startRowIndex >= at ? m.startRowIndex + 1 : m.startRowIndex,
      endRowIndex: m.endRowIndex > at ? m.endRowIndex + 1 : m.endRowIndex,
    })),
  };
}

export function findText(grid: MathGridInput, text: string): { row: number; col: number }[] {
  const hits: { row: number; col: number }[] = [];
  grid.cells.forEach((row, r) => row.forEach((v, c) => v === text && hits.push({ row: r, col: c })));
  return hits;
}

export function setText(grid: MathGridInput, row: number, col: number, text: string): void {
  grid.cells[row]![col] = text;
}
