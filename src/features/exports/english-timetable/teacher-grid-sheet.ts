// 영어 "강사별영어시간표" 탭 = 화면 강사뷰([teacher-grid.tsx])의 exceljs 미러.
// 레이아웃(강사=세로 블록·요일 가로·10분 행·수업 rowSpan 병합·병렬 LAB 레인)은 화면과 **동일 순수 모델**
// (buildTeacherGridModel)을 순회해 emit → 셀 배치가 화면과 구조적으로 일치. server-only는 build-buffer가 소유.
import type { Workbook, Worksheet } from "exceljs";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import { readableTextColor } from "@/lib/color-utils";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { buildTeacherGridModel, type TeacherGridModel } from "@/features/timetable/lib/teacher-grid-model";

/** 강사별 탭 시트명(통합 미니그리드 조회 수식이 INDIRECT로 참조 — 단일 소스). */
export const TEACHER_SHEET_NAME = "강사별영어시간표";

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

// 열 너비(exceljs 문자 단위 ≈ px/7). 시각열·1레인 요일열·다중레인(LAB 서브컬럼).
const TIME_COL_W = 7;
const DAY_COL_W = 12;
const LANE_COL_W = 9;

const THIN = { style: "thin" as const, color: { argb: "FFC4C4C9" } };
const MEDIUM = { style: "medium" as const, color: { argb: "FF505050" } };

/** "#RRGGBB"|"#RGB" → "FFRRGGBB"(ARGB). 유효하지 않으면 fallback. */
function hexToARGB(hex: string | null | undefined, fallback: string): string {
  if (!hex) return fallback;
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length === 6) return `FF${c.toUpperCase()}`;
  if (c.length === 8) return c.toUpperCase();
  return fallback;
}

/** 요일 헤더 "M/D"(주 월요일 기준, UTC 롤오버 안전) — teacher-grid.tsx dayDateLabels 미러. */
function dayDateLabels(weekMonday?: string): Partial<Record<DayOfWeek, string>> {
  if (!weekMonday) return {};
  const [y, m, d] = weekMonday.split("-").map(Number);
  if (!y || !m || !d) return {};
  const out: Partial<Record<DayOfWeek, string>> = {};
  for (const day of DAY_ORDER) {
    const dt = new Date(Date.UTC(y, m - 1, d + DAY_OFFSET[day]));
    out[day] = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  }
  return out;
}

/** "본원304" → "304"(공통 접두 제거). class-grid/통합 shortRoom과 동일 — 강사별 셀·통합 조회 방 표기 일치. */
function shortRoom(room: string): string {
  return room.replace(/^본원/, "") || room;
}

/** 1-based 열 번호 → 엑셀 열 문자(2→"B", 28→"AB"). */
function colLetterOf(n: number): string {
  let x = "", k = n;
  while (k > 0) { x = String.fromCharCode(65 + ((k - 1) % 26)) + x; k = Math.floor((k - 1) / 26); }
  return x;
}

/**
 * 강사별 탭 기하 — 통합 미니그리드 조회 수식이 "어느 요일이 어느 열(강사)이고, 어느 시각이 어느 행인지"
 * 알아야 강사별을 역조회할 수 있다. appendTeacherGridSheet의 열/행 배치와 **동일 규칙**(col1=시각,
 * 강사 좌→우, 각 강사의 요일마다 laneCount 열, 본문 행=BODY_START(3)부터)으로 계산 → 반드시 같은 model로.
 */
export type TeacherGeometry = {
  sheetName: string;
  /** 본문 10분 행: startMin(자정기준 분) → 그 행의 엑셀 행번호(1-based). */
  rows: { startMin: number; row: number }[];
  /** 요일 → 그 요일의 열들(강사별 각 강사·레인) {열번호·열문자·강사명}. 미니그리드가 이 열들을 역조회. */
  dayColumns: Partial<Record<DayOfWeek, { col: number; colLetter: string; teacher: string }[]>>;
};

/** buildTeacherGridModel 결과 → 강사별 시트 기하(열=요일·강사, 행=시각). appendTeacherGridSheet와 동일 배치.
 *  슬롯 타입 T-무관(name·cols.{day,laneCount}·rows.startMin만 읽음)이라 최소 구조로 받는다. */
export function computeTeacherGeometry(
  model: { teachers: { name: string; cols: { day: DayOfWeek; laneCount: number }[] }[]; rows: { startMin: number }[] },
  sheetName: string,
): TeacherGeometry {
  const dayColumns: TeacherGeometry["dayColumns"] = {};
  let abs = 2; // col 1 = 시각
  for (const t of model.teachers) {
    for (const col of t.cols) {
      for (let l = 0; l < col.laneCount; l++) {
        (dayColumns[col.day] ??= []).push({ col: abs, colLetter: colLetterOf(abs), teacher: t.name });
        abs++;
      }
    }
  }
  const rows = model.rows.map((r, ri) => ({ startMin: r.startMin, row: 3 + ri })); // BODY_START=3
  return { sheetName, rows, dayColumns };
}

export type TeacherSheetOpts = {
  teacherColors?: TeacherColorMap;
  stepMin?: number;
  breakRanges?: { start: string; end: string }[];
  excludedTeachers?: string[];
  /** 교시 경계(가로 진한선) 시각 — 과목 설정 teacherViewLines(자정 기준 분). */
  sectionLineMins?: number[];
  weekMonday?: string;
  sheetName?: string;
  /** 사전계산 모델(build-buffer가 통합 지오메트리와 공유) — 미지정 시 내부 계산. */
  model?: TeacherGridModel<ScheduleSlotWithStudents>;
};

/**
 * 강사별 영어시간표 워크시트를 워크북에 추가. 화면 강사뷰와 동일 모델을 emit(강사색·병합·LAB 레인·방).
 */
export function appendTeacherGridSheet(
  wb: Workbook,
  slots: ScheduleSlotWithStudents[],
  opts: TeacherSheetOpts = {},
): Worksheet {
  const stepMin = opts.stepMin ?? 10;
  const { rows, teachers } = opts.model ?? buildTeacherGridModel(slots, {
    stepMin,
    breakRanges: opts.breakRanges,
    excludedTeachers: opts.excludedTeachers,
    teacherColors: opts.teacherColors,
  });
  const dayDates = dayDateLabels(opts.weekMonday);
  // 교시 경계 = step 격자에 스냅된 분 집합(화면 periodEdgeMins와 동일).
  const periodEdgeMins = new Set(
    (opts.sectionLineMins ?? []).map((mm) => Math.floor(mm / stepMin) * stepMin),
  );

  const sheet = wb.addWorksheet((opts.sheetName ?? "강사별영어시간표").slice(0, 31), {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });

  // ── 컬럼 배치: col 1 = 시각, 이후 강사×요일×레인(flat). 병합/테두리용 범위 사전계산. ──
  type LaneCol = { teacherIdx: number; colIdx: number; lane: number; absCol: number };
  const laneCols: LaneCol[] = [];
  const teacherRange: { start: number; end: number }[] = []; // 강사별 [absCol start,end]
  const dayRanges: { teacherIdx: number; colIdx: number; start: number; laneCount: number; day: DayOfWeek }[] = [];
  const teacherLastCol = new Set<number>(); // 강사 경계(진한 우측선) absCol

  let abs = 2;
  teachers.forEach((t, ti) => {
    const tStart = abs;
    t.cols.forEach((col, ci) => {
      const dStart = abs;
      for (let l = 0; l < col.laneCount; l++) {
        laneCols.push({ teacherIdx: ti, colIdx: ci, lane: l, absCol: abs });
        sheet.getColumn(abs).width = col.laneCount > 1 ? LANE_COL_W : DAY_COL_W;
        abs++;
      }
      dayRanges.push({ teacherIdx: ti, colIdx: ci, start: dStart, laneCount: col.laneCount, day: col.day });
    });
    teacherRange[ti] = { start: tStart, end: abs - 1 };
    teacherLastCol.add(abs - 1);
  });
  const lastCol = abs - 1;
  sheet.getColumn(1).width = TIME_COL_W;

  const TEACHER_ROW = 1;
  const DAY_ROW = 2;
  const BODY_START = 3;
  const rowPt = Math.max(12, Math.round(stepMin * 1.2)); // 10분→12pt, 30분→36pt (분당 균일 높이).

  // ── Row 1: 강사 밴드(색) ──
  sheet.getRow(TEACHER_ROW).height = 20;
  const corner = sheet.getCell(TEACHER_ROW, 1);
  corner.value = "시각";
  corner.alignment = { horizontal: "center", vertical: "middle" };
  corner.font = { bold: true, size: 9 };
  corner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
  sheet.mergeCells(TEACHER_ROW, 1, DAY_ROW, 1);
  teachers.forEach((t, ti) => {
    const { start, end } = teacherRange[ti];
    if (end > start) sheet.mergeCells(TEACHER_ROW, start, TEACHER_ROW, end);
    const cell = sheet.getCell(TEACHER_ROW, start);
    cell.value = t.name;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    if (t.color) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToARGB(t.color.bg, "FF3B82F6") } };
      cell.font = { bold: true, size: 11, color: { argb: hexToARGB(t.color.text, "FFFFFFFF") } };
    } else {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
      cell.font = { bold: true, size: 11 };
    }
  });

  // ── Row 2: 요일 행 ──
  sheet.getRow(DAY_ROW).height = 22;
  for (const dr of dayRanges) {
    if (dr.laneCount > 1) sheet.mergeCells(DAY_ROW, dr.start, DAY_ROW, dr.start + dr.laneCount - 1);
    const cell = sheet.getCell(DAY_ROW, dr.start);
    const date = dayDates[dr.day];
    cell.value = date ? `${DAY_LABEL[dr.day] ?? dr.day} ${date}` : (DAY_LABEL[dr.day] ?? dr.day);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { bold: true, size: 9, color: { argb: "FF3A433E" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F4" } };
  }

  // ── 본문: 행=10분 격자. 시각열 + 강사×요일×레인 블록/빈칸/쉬는시간. ──
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const excelRow = BODY_START + ri;
    sheet.getRow(excelRow).height = rowPt;
    const timeCell = sheet.getCell(excelRow, 1);
    timeCell.value = row.key;
    timeCell.alignment = { horizontal: "right", vertical: "top" };
    timeCell.font = row.isHour ? { bold: true, size: 8 } : { size: 8, color: { argb: "FF969699" } };
    timeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9F8" } };

    for (const t of teachers) {
      for (let ci = 0; ci < t.cols.length; ci++) {
        const col = t.cols[ci];
        const dayColStart = dayRanges.find((d) => d.teacherIdx === teachers.indexOf(t) && d.colIdx === ci)!.start;
        // 쉬는 시간 밴드(앵커 행) — 전 레인 colSpan.
        const brk = col.breakAnchors.get(ri);
        if (brk) {
          if (col.laneCount > 1 || brk.span > 1)
            sheet.mergeCells(excelRow, dayColStart, excelRow + brk.span - 1, dayColStart + col.laneCount - 1);
          const cell = sheet.getCell(excelRow, dayColStart);
          cell.value = "쉬는 시간";
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.font = { size: 8, color: { argb: "FF969699" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECEFED" } };
          continue;
        }
        if (col.breakCovered.has(ri)) continue;
        for (let l = 0; l < col.laneCount; l++) {
          const absCol = dayColStart + l;
          if (col.laneCovered.has(`${ri}:${l}`)) continue;
          const anchor = col.laneAnchors.get(`${ri}:${l}`);
          if (!anchor) continue; // 빈 셀 — 테두리는 후처리 격자 패스에서.
          const s = anchor.interval.slots[0];
          if (anchor.span > 1) sheet.mergeCells(excelRow, absCol, excelRow + anchor.span - 1, absCol);
          const cell = sheet.getCell(excelRow, absCol);
          const room = s.slotRoomLabel ? shortRoom(s.slotRoomLabel) : "";
          cell.value = room ? `${s.className}\n${room}` : s.className;
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          const bg = hexToARGB(s.classBgColor, "FFF1F5F4");
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          const txt = s.classTextColor
            ? hexToARGB(s.classTextColor, "FF1D1D1F")
            : hexToARGB(readableTextColor(s.classBgColor ?? "#f1f5f4") || "#1d1d1f", "FF1D1D1F");
          cell.font = { bold: true, size: 9, color: { argb: txt } };
        }
      }
    }
  }

  // ── 테두리 격자 패스: 전 본문 셀 THIN, 강사 경계·교시 경계는 MEDIUM. ──
  const bodyLastRow = BODY_START + rows.length - 1;
  const teacherEdgeCols = teacherLastCol;
  // 컬럼 → 그 강사의 '가로줄 제외' 여부(과목 설정 teacherViewLineExcluded). 시각열(c=1)은 전역 참조라 제외 안 함.
  const colExcluded: Record<number, boolean> = {};
  for (const lc of laneCols) colExcluded[lc.absCol] = teachers[lc.teacherIdx].lineExcluded;
  for (let r = TEACHER_ROW; r <= bodyLastRow; r++) {
    const ri = r - BODY_START; // 본문 행 인덱스(<0 = 헤더)
    // 이 행 아래가 교시 경계인가(화면 bottomEdge: rows[ri+1] 시각이 periodEdge).
    const nextMin = ri >= 0 ? rows[ri + 1]?.startMin : undefined;
    const periodEdgeBelow = ri >= 0 && nextMin != null && periodEdgeMins.has(nextMin);
    for (let c = 1; c <= lastCol; c++) {
      const cell = sheet.getCell(r, c);
      // 교시 경계 두꺼운선은 '제외 강사' 컬럼의 **내부** 섹션선에선 옅게(화면 bottomEdge(excluded) 미러).
      // 단 표 하단 프레임(bodyLastRow)·헤더 구분(DAY_ROW)은 전 컬럼 두껍게 — 외곽 프레임 균일.
      const excluded = c !== 1 && colExcluded[c] === true;
      const thickBottom = r === DAY_ROW || r === bodyLastRow || (periodEdgeBelow && !excluded);
      cell.border = {
        top: THIN,
        left: c === 1 ? MEDIUM : THIN,
        right: c === lastCol || teacherEdgeCols.has(c) ? MEDIUM : THIN,
        bottom: thickBottom ? MEDIUM : THIN,
      };
    }
  }

  return sheet;
}
