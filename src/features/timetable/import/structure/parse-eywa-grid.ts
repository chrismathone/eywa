// eywa가 export한 강사별영어시간표 탭(SheetGrid) → 정규화 배치 슬롯(ParsedStructureSlot[]) 순수 파서.
// ⚠️ 구 parse-grid.ts(원본 손시트 구조)와 별개 — 이건 eywa export(appendTeacherGridSheet) 구조 전용.
// export 구조(teacher-grid-sheet.ts):
//   · row0(0-based): 강사 라벨(강사 열들 위로 가로 병합). col0 = "시각"(코너, rows0~1 병합).
//   · row1(0-based): 요일 헤더 "월 7/6"(레인 위로 가로 병합).
//   · row2+(0-based): 10분 데이터행. col0 = 시각("14:20" 24h). 셀 = "반명↵방"(rowSpan 세로병합 = 수업길이).
//     "쉬는 시간" 밴드·빈칸은 스킵. 강사 라벨 = slot_teacher_label ?? teacherName(이미 정제된 라벨).
// 시각은 **행인덱스 10분 산술**(라벨 개별 편집 방어) — 앵커=row2 col0, step=연속 행 차. throw 없이 warnings.

import { koDayToEnum } from "@/features/timetable/lib/periods";
import type {
  ParsedStructure,
  ParsedStructureSlot,
  ParsedTeacherBlock,
  SheetGrid,
} from "./types";

const TEACHER_ROW = 0;
const DAY_ROW = 1;
const DATA_START_ROW = 2;
const TIME_COL = 0;

const DAY_HEAD_RE = /^\s*([월화수목금토])/;
const ROOM_RE = /\b(\d{3}|SKY)\b/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
const SKIP_RE = /^(쉬는\s*시간|수업\s*준비|교수부\s*미팅|연차\s*사용)/;

function cell(grid: SheetGrid, r: number, c: number): string {
  return grid.cells[r]?.[c] ?? "";
}
function parseMin(label: string): number | null {
  const m = label.match(TIME_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function minToHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseEywaTeacherGrid(grid: SheetGrid): ParsedStructure {
  const warnings: string[] = [];
  const rowCount = grid.cells.length;
  const maxCol = Math.max(0, ...grid.cells.map((r) => r.length));

  // 병합 좌상단 → 범위(0-based, r2/c2 inclusive) + 피복 셀 → 앵커 조회.
  const mergeAt = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
  const coverAnchor = new Map<string, string>();
  for (const mg of grid.merges) {
    const key = `${mg.startRowIndex},${mg.startColumnIndex}`;
    mergeAt.set(key, {
      r1: mg.startRowIndex,
      c1: mg.startColumnIndex,
      r2: mg.endRowIndex - 1,
      c2: mg.endColumnIndex - 1,
    });
    for (let r = mg.startRowIndex; r < mg.endRowIndex; r++)
      for (let c = mg.startColumnIndex; c < mg.endColumnIndex; c++) coverAnchor.set(`${r},${c}`, key);
  }

  // col → 강사(row0 블록 앵커, 가로 병합 범위로 확장). col0(시각) 제외.
  const colTeacher: (string | null)[] = new Array(maxCol).fill(null);
  const teachers: ParsedTeacherBlock[] = [];
  for (let c = 1; c < maxCol; c++) {
    const v = cell(grid, TEACHER_ROW, c).trim();
    if (v === "") continue; // 피복(블록 병합) 또는 빈칸
    const mg = mergeAt.get(`${TEACHER_ROW},${c}`);
    const endCol = mg ? mg.c2 : c;
    teachers.push({
      index: teachers.length + 1,
      header: v,
      name: v,
      homeRoom: null,
      note: "",
      reserve: v.startsWith("예비"),
      startColumn: c,
    });
    for (let cc = c; cc <= endCol; cc++) colTeacher[cc] = v;
  }
  const teacherIndexByName = new Map(teachers.map((t) => [t.name, t.index]));

  // col → 요일(row1, 레인 위 가로 병합). 피복 셀은 앵커의 요일 상속.
  const colKoDay: (string | null)[] = new Array(maxCol).fill(null);
  for (let c = 1; c < maxCol; c++) {
    let v = cell(grid, DAY_ROW, c).trim();
    if (v === "") {
      const anchor = coverAnchor.get(`${DAY_ROW},${c}`);
      if (anchor) v = cell(grid, DAY_ROW, Number(anchor.split(",")[1])).trim();
    }
    const ko = v.match(DAY_HEAD_RE)?.[1];
    if (ko) colKoDay[c] = ko;
  }

  // 시각 = 행인덱스 10분 산술(앵커=row2 col0, step=연속 행 차). 라벨 개별 편집 방어.
  const anchorMin = parseMin(cell(grid, DATA_START_ROW, TIME_COL)) ?? 14 * 60 + 20;
  const nextMin = parseMin(cell(grid, DATA_START_ROW + 1, TIME_COL));
  const stepMin = nextMin != null && nextMin > anchorMin ? nextMin - anchorMin : 10;
  const rowStartMin = (r: number) => anchorMin + (r - DATA_START_ROW) * stepMin;

  const slots: ParsedStructureSlot[] = [];
  for (let c = 1; c < maxCol; c++) {
    const teacher = colTeacher[c];
    const koDay = colKoDay[c];
    if (!teacher || !koDay) continue;
    const day = koDayToEnum(koDay);
    if (!day) {
      warnings.push(`요일 인식 실패: col ${c} "${koDay}"`);
      continue;
    }
    for (let r = DATA_START_ROW; r < rowCount; r++) {
      const raw = cell(grid, r, c);
      const trimmed = raw.trim();
      if (trimmed === "" || SKIP_RE.test(trimmed)) continue;
      // 세로병합에 피복된 셀(앵커 아님)은 스킵 — 값은 앵커에만 있으나 이중방어.
      const coverA = coverAnchor.get(`${r},${c}`);
      if (coverA && coverA !== `${r},${c}`) continue;

      const mg = mergeAt.get(`${r},${c}`) ?? { r1: r, c1: c, r2: r, c2: c };
      const span = mg.r2 - mg.r1 + 1;
      const startMin = rowStartMin(mg.r1);
      const endMin = startMin + span * stepMin;

      const lines = raw.split("\n").map((x) => x.trim()).filter(Boolean);
      const className = lines[0] ?? trimmed;
      const roomPart = lines.slice(1).join(" ");
      const room = roomPart.match(ROOM_RE)?.[1] ?? (roomPart || null);

      slots.push({
        teacherIndex: teacherIndexByName.get(teacher) ?? 0,
        teacherName: teacher,
        teacherHeader: teacher,
        day,
        koDay,
        className,
        room,
        startTime: minToHM(startMin),
        endTime: minToHM(endMin),
        rawTimeLabel: cell(grid, mg.r1, TIME_COL).trim(),
        starred: trimmed.startsWith("*"),
        raw,
        grid: mg,
      });
    }
  }

  // blocks는 항상 빈 배열 — eywa export 격자는 **수업만** 그린다(비수업 블록은 마스터 시트 문법이고,
  // 여기로 왕복시키면 export→import에서 사라지거나 반으로 오인된다). 마스터 파서(parse-grid)만 채운다.
  return { tabName: grid.tabName, teachers, slots, blocks: [], warnings };
}
