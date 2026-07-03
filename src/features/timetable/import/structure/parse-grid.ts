// 강사별 그리드(SheetGrid) → 정규화 배치 슬롯(ParsedStructureSlot[]) 순수 파서.
// 구조 가정(현 인재원 영어 강사별 시트):
//   · 1행: 블록 번호(강사 블록마다 6열 간격, B/H/N/…)
//   · 2행: 강사명 + 담임 방 + 메모   · 3행: 근무 메모
//   · 4행: 블록 내 요일 헤더(월~토, 열마다 1개)   · A열: 시각 라벨(교시 = "4:20~5:00" 범위)
//   · 데이터 셀: "수업명/방번호"(병합셀 = 한 수업). 값은 병합 좌상단에만 존재.
// 파서는 throw하지 않는다 — 인식 못한 셀은 건너뛰고 warnings에 남긴다(자유 편집 시트 방어).

import { koDayToEnum } from "@/features/timetable/lib/periods";
import type {
  ParsedStructure,
  ParsedStructureSlot,
  ParsedTeacherBlock,
  SheetGrid,
} from "./types";

const HEADER_ROW = 1; // 0-based: 강사명 행(2행)
const NOTE_ROW = 2; // 0-based: 메모 행(3행)
const DAY_ROW = 3; // 0-based: 요일 헤더 행(4행)
const DATA_START_ROW = 4; // 0-based: 데이터 시작(5행)
const TIME_COL = 0; // A열

const ROOM_RE = /\b(\d{3}|SKY)\b/;
const DAY_HEAD_RE = /^\s*([월화수목금토])/;
const TIME_TOKEN_RE = /\d{1,2}:\d{2}/g;

function cell(grid: SheetGrid, r: number, c: number): string {
  return grid.cells[r]?.[c] ?? "";
}

/** "4:20~5:00"·"9:50~10:00" 등 오후 학원 시각을 24h "HH:MM"로. 오전 라벨(1~11시)은 +12(오후). */
function to24(token: string): string {
  const [hStr, mStr] = token.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (h < 12) h += 12; // 2:20 → 14:20, 10:00 → 22:00 (A열은 전부 오후~밤)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A열 라벨에서 {start, end} 추출. 범위("A~B")면 첫·끝, 단일이면 end=null. */
function parseTimeLabel(label: string): { start: string | null; end: string | null } {
  const toks = label.match(TIME_TOKEN_RE);
  if (!toks || toks.length === 0) return { start: null, end: null };
  return {
    start: to24(toks[0]!),
    end: toks.length > 1 ? to24(toks[toks.length - 1]!) : null,
  };
}

/** 헤더 "Jane 추민아 301 …" → 선두 강사명 토큰(영문 또는 한글 2~4자). */
function leadName(header: string): string {
  const h = header.trim();
  const m = h.match(/^([A-Za-z]+|[가-힣]{2,4})/);
  return m ? m[1]! : h.slice(0, 10);
}

/** "수업명/방\n\n…"에서 수업명(첫 세그먼트). */
function className(raw: string): string {
  return raw.split(/[/\n]/)[0]!.trim();
}

export function parseTeacherGrid(grid: SheetGrid): ParsedStructure {
  const warnings: string[] = [];
  const rowCount = grid.cells.length;

  // 병합 좌상단 → 범위(0-based, r2/c2 inclusive) 조회맵.
  const mergeAt = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
  for (const mg of grid.merges) {
    mergeAt.set(`${mg.startRowIndex},${mg.startColumnIndex}`, {
      r1: mg.startRowIndex,
      c1: mg.startColumnIndex,
      r2: mg.endRowIndex - 1,
      c2: mg.endColumnIndex - 1,
    });
  }

  // 블록 시작 열 = 1행(0-based 0)에서 A열 제외(col>=1) 값이 있는 열.
  const startCols: number[] = [];
  const firstRow = grid.cells[0] ?? [];
  for (let c = 1; c < firstRow.length; c++) {
    if ((firstRow[c] ?? "") !== "") startCols.push(c);
  }

  const teachers: ParsedTeacherBlock[] = [];
  const slots: ParsedStructureSlot[] = [];

  startCols.forEach((bc, i) => {
    const nextCol = i + 1 < startCols.length ? startCols[i + 1]! : (grid.cells[DAY_ROW]?.length ?? bc + 6);
    const header = cell(grid, HEADER_ROW, bc).trim();
    const homeRoom = header.match(ROOM_RE)?.[1] ?? null;
    const block: ParsedTeacherBlock = {
      index: Math.trunc(Number(cell(grid, 0, bc)) || i + 1),
      header,
      name: leadName(header),
      homeRoom,
      note: cell(grid, NOTE_ROW, bc).trim(),
      reserve: header.startsWith("예비"),
      startColumn: bc,
    };
    teachers.push(block);

    // 이 블록의 요일 열(4행 헤더 기준).
    for (let c = bc; c < nextCol; c++) {
      const koDay = cell(grid, DAY_ROW, c).match(DAY_HEAD_RE)?.[1];
      if (!koDay) continue;
      const day = koDayToEnum(koDay);
      if (!day) {
        warnings.push(`요일 인식 실패: (${DAY_ROW},${c}) "${cell(grid, DAY_ROW, c)}"`);
        continue;
      }

      // 데이터 셀 순회 — 값 있는 셀만(병합은 좌상단에만 값). 각 셀 = 한 수업.
      for (let r = DATA_START_ROW; r < rowCount; r++) {
        const raw = cell(grid, r, c);
        if (raw === "") continue;
        const mg = mergeAt.get(`${r},${c}`) ?? { r1: r, c1: c, r2: r, c2: c };

        const topLabel = cell(grid, mg.r1, TIME_COL);
        const t = parseTimeLabel(topLabel);
        let { start, end } = t;
        if (!start) {
          warnings.push(`시각 인식 실패: (${mg.r1},${TIME_COL}) "${topLabel}" — ${className(raw)}`);
          continue;
        }
        // 상단 라벨이 단일 시각이면 병합 하단행 라벨에서 끝시각 보완.
        if (!end && mg.r2 > mg.r1) end = parseTimeLabel(cell(grid, mg.r2, TIME_COL)).end;

        const room = raw.match(ROOM_RE)?.[1] ?? block.homeRoom;
        const slot: ParsedStructureSlot = {
          teacherIndex: block.index,
          teacherName: block.name,
          teacherHeader: block.header,
          day,
          koDay,
          className: className(raw),
          room,
          startTime: start,
          endTime: end,
          rawTimeLabel: topLabel.trim(),
          starred: raw.trimStart().startsWith("*"),
          raw,
          grid: mg,
        };
        slots.push(slot);
      }
    }
  });

  return { tabName: grid.tabName, teachers, slots, warnings };
}
