// 영어 "통합영어시간표" 탭 = 화면 통합뷰([rich-card-group.tsx])의 exceljs 미러(파생 — 강사별과 같은 슬롯에서).
// 섹션(시작 교시 그룹)마다: 좌측 라벨열 + 반=열(반명·담임·강의실·요일×교시 미니그리드·재원/대기/퇴원 명단).
// 데이터는 buildRichCardGroups 단일 소스(화면과 동일). server-only는 build-buffer가 소유.
import type { Workbook, Worksheet } from "exceljs";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { enumDayToKo } from "@/features/timetable/lib/periods";
import {
  buildRichCardGroups,
  type GridSlot,
  type GridStudent,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { readableTextColor } from "@/lib/color-utils";

const LABEL_W = 11;
const DAY_SUB_W = 8;

const THIN = { style: "thin" as const, color: { argb: "FFC4C4C9" } };
const MEDIUM = { style: "medium" as const, color: { argb: "FF505050" } };

// 강사 라벨(DB색 없을 때) 해시 폴백 팔레트 — 화면 teacherColor(tailwind)를 엑셀 hex로 대체.
const HASH_PALETTE = ["FF3B82F6", "FF8B5CF6", "FFEC4899", "FF10B981", "FFEF4444"];
function hashColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return HASH_PALETTE[h % HASH_PALETTE.length];
}

function hexToARGB(hex: string | null | undefined, fallback: string): string {
  if (!hex) return fallback;
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length === 6) return `FF${c.toUpperCase()}`;
  if (c.length === 8) return c.toUpperCase();
  return fallback;
}

function abbrev(label: string): string {
  return label.length > 4 ? label.slice(0, 4) : label;
}

/** 학생 표시 텍스트 — "이름 (English)  학교 학년"(RosterRow 미러). */
function studentText(s: GridStudent): string {
  const name = s.englishName ? `${s.name} (${s.englishName})` : s.name;
  const meta = [s.school, s.grade].filter(Boolean).join(" ");
  return meta ? `${name}  ${meta}` : name;
}

export type IntegratedSheetOpts = {
  config: PeriodsConfig;
  teacherColors?: TeacherColorMap;
  /** 반 헤더색 폴백(과목 소프트 hex) — card.bgColor 없을 때. */
  subjectSoftHex?: string;
  sheetName?: string;
};

/**
 * 통합 영어시간표 워크시트 추가. buildRichCardGroups로 섹션·카드 도출 → 라벨열 + 반=열 블록 emit.
 * 명단은 캡 없이 전원 표기(스프레드시트라 스크롤 대신 전개 — 무음 절단 없음).
 */
export function appendIntegratedSheet(
  wb: Workbook,
  slots: ScheduleSlotWithStudents[],
  opts: IntegratedSheetOpts,
): Worksheet {
  const teacherColors = opts.teacherColors ?? {};
  const subjectSoft = opts.subjectSoftHex ?? "FFEDEFEE";
  // ScheduleSlotWithStudents는 GridSlot과 구조 호환(class-grid 주석) — 그대로 전달.
  const groups = buildRichCardGroups(slots as unknown as GridSlot[], opts.config);

  const sheet = wb.addWorksheet((opts.sheetName ?? "통합영어시간표").slice(0, 31), {
    views: [{ state: "frozen", xSplit: 1, ySplit: 0 }],
  });
  sheet.getColumn(1).width = LABEL_W;

  let cursor = 1; // 다음에 쓸 엑셀 행
  let maxCol = 1;

  const setCell = (
    r: number,
    c: number,
    value: string,
    fmt?: {
      bg?: string;
      color?: string;
      bold?: boolean;
      size?: number;
      align?: "left" | "center" | "right";
      strike?: boolean;
      wrap?: boolean;
    },
  ) => {
    const cell = sheet.getCell(r, c);
    cell.value = value;
    cell.alignment = { horizontal: fmt?.align ?? "center", vertical: "middle", wrapText: fmt?.wrap ?? false };
    cell.font = {
      bold: fmt?.bold ?? false,
      size: fmt?.size ?? 10,
      strike: fmt?.strike ?? false,
      ...(fmt?.color ? { color: { argb: fmt.color } } : {}),
    };
    if (fmt?.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fmt.bg } };
    return cell;
  };

  for (const group of groups) {
    const cards = group.cards;
    const days = group.days;
    if (cards.length === 0) continue;

    // 카드별 시작 컬럼(각 카드 = days.length 서브컬럼).
    const cardStart: number[] = [];
    let col = 2;
    for (let i = 0; i < cards.length; i++) {
      cardStart[i] = col;
      for (let d = 0; d < days.length; d++) sheet.getColumn(col + d).width = DAY_SUB_W;
      col += days.length;
    }
    const rowEndCol = col - 1;
    maxCol = Math.max(maxCol, rowEndCol);

    // ── 섹션 타이틀 ──
    const titleRow = cursor++;
    sheet.mergeCells(titleRow, 1, titleRow, rowEndCol);
    setCell(titleRow, 1, `${group.label}  ·  ${cards.length}개 수업`, {
      bg: "FF2A322E", color: "FFFFFFFF", bold: true, size: 11, align: "left",
    });
    sheet.getRow(titleRow).height = 20;

    // ── 수업명 ──
    const nameRow = cursor++;
    setCell(nameRow, 1, "수업명", { bg: "FFE9E9EE", bold: true, size: 9 });
    cards.forEach((c, i) => {
      const st = cardStart[i];
      if (days.length > 1) sheet.mergeCells(nameRow, st, nameRow, st + days.length - 1);
      const bg = c.bgColor ? hexToARGB(c.bgColor, subjectSoft) : subjectSoft;
      const color = c.bgColor
        ? hexToARGB(c.textColor ?? (readableTextColor(c.bgColor) || "#1d1d1f"), "FF1D1D1F")
        : "FF1D1D1F";
      setCell(nameRow, st, c.className, { bg, color, bold: true, size: 11, wrap: true });
    });
    sheet.getRow(nameRow).height = 24;

    // ── 담임 ──
    const teacherRow = cursor++;
    setCell(teacherRow, 1, "담임", { bg: "FFE9E9EE", bold: true, size: 9 });
    cards.forEach((c, i) => {
      const st = cardStart[i];
      if (days.length > 1) sheet.mergeCells(teacherRow, st, teacherRow, st + days.length - 1);
      const tc = c.teacherName ? teacherColors[c.teacherName] : undefined;
      setCell(teacherRow, st, c.teacherName ?? "-", {
        bg: tc ? hexToARGB(tc.bg, "FFE9E9EE") : undefined,
        color: tc ? hexToARGB(tc.text, "FF1D1D1F") : undefined,
        bold: true,
        size: 10,
      });
    });

    // ── 강의실 ──
    const roomRow = cursor++;
    setCell(roomRow, 1, "강의실", { bg: "FFE9E9EE", bold: true, size: 9 });
    cards.forEach((c, i) => {
      const st = cardStart[i];
      if (days.length > 1) sheet.mergeCells(roomRow, st, roomRow, st + days.length - 1);
      setCell(roomRow, st, c.classroomLabel, { size: 9, wrap: true, color: "FF505050" });
    });

    // ── 요일 헤더 ──
    const dayHeadRow = cursor++;
    setCell(dayHeadRow, 1, "교시", { bg: "FFE9E9EE", bold: true, size: 9 });
    cards.forEach((_, i) => {
      const st = cardStart[i];
      days.forEach((d, di) => {
        const weekend = d === "sat" || d === "sun";
        setCell(dayHeadRow, st + di, enumDayToKo(d), {
          bg: "FFF2F2F4", bold: true, size: 9, color: weekend ? "FFB4436C" : "FF505050",
        });
      });
    });

    // ── 요일×교시 미니그리드 ──
    for (const p of group.periodRows) {
      const pr = cursor++;
      setCell(pr, 1, `${p.label}\n${p.time}`, { bg: "FFF7F9F8", bold: true, size: 8, wrap: true });
      cards.forEach((c, i) => {
        const st = cardStart[i];
        days.forEach((d, di) => {
          const cell = c.cells[`${p.order}:${d}`];
          if (!cell || !cell.label) {
            setCell(pr, st + di, "", {});
            return;
          }
          // 특수 자리(LAB·JJ) — 사람이 아니라 방이라 강사색 대신 고정색. 두 자리는 라벨로 구분된다.
          if (cell.isLab) {
            setCell(pr, st + di, cell.label, {
              bg: "FFDBEAFE",
              color: "FF1D4ED8",
              bold: true,
              size: 9,
            });
            return;
          }
          const tc = teacherColors[cell.label];
          const bg = tc ? hexToARGB(tc.bg, "FFE9E9EE") : hashColor(cell.label);
          const color = tc ? hexToARGB(tc.text, "FFFFFFFF") : "FFFFFFFF";
          setCell(pr, st + di, abbrev(cell.label), { bg, color, bold: true, size: 9 });
        });
      });
    }

    // ── 명단(재원/대기/퇴원) — 캡 없이 전원. 섹션 라벨은 첫 행에, 나머지 병합. ──
    const rosterBlock = (
      title: string,
      pick: (c: (typeof cards)[number]) => GridStudent[],
      labelBg: string,
    ) => {
      const n = Math.max(1, ...cards.map((c) => pick(c).length));
      const startRow = cursor;
      for (let i = 0; i < n; i++) {
        const rr = cursor++;
        cards.forEach((c, ci) => {
          const st = cardStart[ci];
          const list = pick(c);
          if (days.length > 1) sheet.mergeCells(rr, st, rr, st + days.length - 1);
          const s = list[i];
          if (!s) {
            setCell(rr, st, "", {});
            return;
          }
          const withdrawn = s.status === "withdrawn";
          const bg = withdrawn
            ? "FFF3F4F3"
            : s.isTransferredIn
              ? "FFDCF5E7"
              : s.isNew
                ? "FFFBE2E2"
                : undefined;
          setCell(rr, st, studentText(s), {
            align: "left",
            size: 9,
            bg,
            strike: withdrawn,
            color: withdrawn ? "FF8A948E" : undefined,
          });
        });
      }
      // 라벨 셀 — 블록이 2행 이상일 때만 세로 병합(1행이면 병합 불필요, exceljs 1x1 병합 회피).
      if (cursor - 1 > startRow) sheet.mergeCells(startRow, 1, cursor - 1, 1);
      setCell(startRow, 1, title, { bg: labelBg, bold: true, size: 9 });
    };
    rosterBlock("재원", (c) => c.active, "FFE6F2EC");
    rosterBlock("대기", (c) => c.hold, "FFF7E7EC");
    rosterBlock("퇴원", (c) => c.withdrawn, "FFEDEFEE");

    // 섹션 간 간격 한 행.
    cursor++;
  }

  // ── 테두리 격자 패스(섹션들이 쓴 전 범위 THIN, 좌측 프레임 MEDIUM). ──
  const lastRow = cursor - 1;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const cell = sheet.getCell(r, c);
      if (!cell.border) {
        cell.border = { top: THIN, bottom: THIN, left: c === 1 ? MEDIUM : THIN, right: THIN };
      }
    }
  }

  return sheet;
}
