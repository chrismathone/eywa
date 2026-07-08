// 인재원 "통합영어시간표(7월)" **원본 손작업 시트 서식을 그대로** 재현하는 exceljs 익스포터.
// 실측 스펙: scratchpad/rebuild-spec.md (원본 style-raw.json 셀별 서식 기반).
//   상단 제목(C:AP 40열, 25pt, bg #efefef) + 레벨 범례
//   섹션(시작시각별) = 반헤더(3줄: 반명↵스케줄↵(강사), bg=반색) · 방행(bg=반색) · 요일헤더(월화수목금)
//     · 교시격자(A열 시간범위·B열 교시#·셀="강사↵↵방" bg=강사색·LAB bg #daeef3)
//     · 명단(순번1~11, 이름 C:E·학교학년 F:G) · 정원(bg #c6d9f0)/인원/대기(2)/퇴원생 명단(3)/퇴원수
//     · 섹션 사이 #999999 회색 2행 밴드.
// ⚠️ eywa 미보유(정원=classes.capacity 없으면 공백 / 수강료·레벨진행표=미지원)은 공백/생략.
import type { Workbook, Worksheet, Borders } from "exceljs";
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";
import { type PeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { readableTextColor } from "@/lib/color-utils";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };

const FONT = "Arial";
// 색(ARGB) — 원본 실측.
const TITLE_BG = "FFEFEFEF";
const CAP_BG = "FFC6D9F0"; // 정원 행
const LAB_BG = "FFDAEEF3";
const GRAY_BG = "FF999999"; // 섹션 구분 밴드
// 강사색 폴백 파스텔(eywa teacherColorMap에 색 없을 때, 강사별 구분 유지).
const PASTELS = ["FFBBDEFB", "FFC8E6C9", "FFFFE0B2", "FFF8BBD0", "FFD1C4E9", "FFB2EBF2", "FFFFF9C4", "FFD7CCC8"];

type Line = { style: "medium" | "thin"; color: { argb: string } };
const SM: Line = { style: "medium", color: { argb: "FF000000" } }; // 굵은 검정(원본 SOLID_MEDIUM)
const SS: Line = { style: "thin", color: { argb: "FF000000" } }; // 얇은 검정(원본 SOLID)

const hhmm = (t: string) => String(t).slice(0, 5);
const toMin = (t: string) => {
  const [h, m] = hhmm(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const minutesToHM = (mm: number) => `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
/** "14:20"→"2:20", "09:00"→"9:00"(12시간, 선행0 없음 — 원본 표기). */
const to12 = (t: string) => {
  const mm = toMin(t);
  const h = Math.floor(mm / 60);
  const m = mm % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
};
const ampm = (mm: number) => (mm < 12 * 60 ? "오전" : "오후");

const hexToARGB = (hex: string | null | undefined, fallback = "FFFFFFFF"): string => {
  if (!hex) return fallback;
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length === 6) return `FF${c.toUpperCase()}`;
  if (c.length === 8) return c.toUpperCase();
  return fallback;
};
const hashIdx = (s: string, mod: number) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % mod;
};

const studentName = (s: StudentLine) => (s.englishName ? `${s.name}(${s.englishName})` : s.name);
// "종로초2" — 학교(초/중/고 포함) + 학년 숫자만(eywa grade "초6"의 레벨 접두 제거해 원본 표기 일치).
const schoolGrade = (s: StudentLine) => `${s.school ?? ""}${(s.grade ?? "").replace(/\D/g, "")}`;
/** 요일 압축 — 전 평일이면 "매일", 아니면 "월수목". */
const dayCompact = (days: Weekday[]) => (days.length === 5 ? "매일" : days.map((d) => DAY_KO[d]).join(""));

type Cell = { teacher: string; room: string; isLab: boolean };
type ClassInfo = {
  classId: string;
  className: string;
  teacher: string;
  bgColor: string; // ARGB(반 색)
  capacity: number | null;
  minStart: number;
  scheduleText: string; // "매일 2:20~3:40"
  roomText: string; // "월화수목금 602" / "월수 605 / 목 602"
  cells: Map<string, Cell>; // `${periodId}:${day}`
  periodIdx: Set<number>; // 사용 교시 index(0-based)
  active: StudentLine[];
  hold: StudentLine[];
  withdrawn: StudentLine[];
};

/** 요일별 방 요약 — "월화수목금 602" 또는 "월수 605 / 목 602"(같은 방집합 요일끼리 묶음). */
function roomSummary(perDayRooms: Map<Weekday, Set<string>>): string {
  const dayStr = new Map<Weekday, string>();
  for (const d of WEEKDAYS) {
    const set = perDayRooms.get(d);
    if (set && set.size) dayStr.set(d, [...set].sort().join("·"));
  }
  if (dayStr.size === 0) return "";
  const distinct = [...new Set(dayStr.values())];
  if (distinct.length === 1) return distinct[0];
  const byRoom = new Map<string, Weekday[]>();
  for (const d of WEEKDAYS) {
    const r = dayStr.get(d);
    if (!r) continue;
    (byRoom.get(r) ?? byRoom.set(r, []).get(r)!).push(d);
  }
  return [...byRoom.entries()].map(([r, days]) => `${dayCompact(days)} ${r}`).join(" / ");
}

/** 슬롯 → 반 정보. periodIndex: 시작시각이 속한 영어 교시 index(0-based, 시각순). */
function buildClassInfos(
  slots: ScheduleSlotWithStudents[],
  config: PeriodsConfig,
  capacityByClassId: Record<string, number | null>,
): { infos: ClassInfo[]; periods: { id: string; start: number; end: number }[] } {
  const table = weekdayTableFor("english", config);
  const periods = Object.entries(table)
    .map(([id, t]) => ({ id, start: toMin(t.startTime), end: toMin(t.endTime) }))
    .sort((a, b) => a.start - b.start);
  const periodIndexOf = (startTime: string): number => {
    const m = toMin(startTime);
    const i = periods.findIndex((p) => m >= p.start && m < p.end);
    if (i >= 0) return i;
    const j = periods.findIndex((p) => p.start === m);
    return j >= 0 ? j : 0;
  };

  const byClass = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    if (!WEEKDAYS.includes(s.dayOfWeek as Weekday)) continue; // 통합은 평일만
    (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  }

  const infos: ClassInfo[] = [];
  for (const [classId, group] of byClass) {
    const first = group[0];
    const cells = new Map<string, Cell>();
    const periodIdx = new Set<number>();
    const perDayRooms = new Map<Weekday, Set<string>>();
    const slotTeacherCount = new Map<string, number>();
    let minStart = Infinity;
    let maxEnd = 0;
    const daySet = new Set<Weekday>();
    for (const s of group) {
      const day = s.dayOfWeek as Weekday;
      daySet.add(day);
      const pi = periodIndexOf(s.startTime);
      periodIdx.add(pi);
      const isLab = s.slotTeacherLabel === "LAB";
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      const room = s.slotRoomLabel ?? "";
      cells.set(`${pi}:${day}`, { teacher, room, isLab });
      if (s.slotTeacherLabel && !isLab)
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      if (room) (perDayRooms.get(day) ?? perDayRooms.set(day, new Set()).get(day)!).add(room);
      minStart = Math.min(minStart, toMin(s.startTime));
      maxEnd = Math.max(maxEnd, toMin(s.endTime));
    }
    const topSlot = [...slotTeacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const teacher = first.teacherName ?? topSlot ?? "";
    const days = WEEKDAYS.filter((d) => daySet.has(d));
    const scheduleText = `${dayCompact(days)} ${to12(minutesToHM(minStart))}~${to12(minutesToHM(maxEnd))}`;
    const students = first.students;
    infos.push({
      classId,
      className: first.className,
      teacher,
      bgColor: hexToARGB(first.classBgColor, PASTELS[hashIdx(classId, PASTELS.length)]),
      capacity: capacityByClassId[classId] ?? null,
      minStart,
      scheduleText,
      roomText: roomSummary(perDayRooms),
      cells,
      periodIdx,
      active: students.filter((s) => s.status === "active"),
      hold: students.filter((s) => s.status === "hold"),
      withdrawn: students.filter((s) => s.status === "withdrawn"),
    });
  }
  infos.sort((a, b) => a.minStart - b.minStart || a.className.localeCompare(b.className, "ko"));
  return { infos, periods };
}

export type InjaewonSheetOpts = {
  config: PeriodsConfig;
  capacityByClassId?: Record<string, number | null>;
  teacherColors?: TeacherColorMap;
  sheetName?: string;
  title?: string;
};

const LEVEL_LEGEND =
  "※ Class Level : Phonics → Pre Let's → Ready To Talk → Let's Talk → Ready to Speak → Let's Speak → Let's Express → Kopi Wang → Pre Junior → Junior Plus → Senior Plus";

const CLASS_COLS = 5; // 월화수목금
const NAME_COLS = 3; // 이름 병합(C:E)
const START_COL = 3; // 첫 반 블록 시작(C)

/** 인재원 통합영어시간표 워크시트 추가 — 원본 손작업 서식 재현. */
export function appendInjaewonIntegratedSheet(
  wb: Workbook,
  slots: ScheduleSlotWithStudents[],
  opts: InjaewonSheetOpts,
): Worksheet {
  const { infos, periods } = buildClassInfos(slots, opts.config, opts.capacityByClassId ?? {});
  const teacherColors = opts.teacherColors ?? {};
  const teacherBg = (label: string): string => {
    const c = teacherColors[label]?.bg;
    return c ? hexToARGB(c) : PASTELS[hashIdx(label, PASTELS.length)];
  };
  // 셀 글자색 — 저장 text색 우선, 없으면 배경 대비 자동(어두운 강사색엔 흰 글자). 원본은 검정이나 eywa는 짙은 색도 있음.
  const teacherFg = (label: string): string => {
    const t = teacherColors[label]?.text;
    const bg = teacherColors[label]?.bg;
    if (t) return hexToARGB(t, "FF000000");
    if (bg) return hexToARGB(readableTextColor(bg), "FF000000");
    return "FF000000";
  };

  // 섹션 = 반의 최초 시작시각.
  const sectionMap = new Map<number, ClassInfo[]>();
  for (const c of infos) (sectionMap.get(c.minStart) ?? sectionMap.set(c.minStart, []).get(c.minStart)!).push(c);
  const sections = [...sectionMap.entries()].sort((a, b) => a[0] - b[0]);
  const maxClasses = Math.max(1, ...sections.map(([, cs]) => cs.length));
  const globalEndCol = START_COL + CLASS_COLS * maxClasses - 1;

  const sheet = wb.addWorksheet((opts.sheetName ?? "통합영어시간표").slice(0, 31), {
    views: [{ state: "normal" }],
  });

  // 열폭(원본 px→exceljs width ≈ (px-5)/7). A=83·B=53·나머지=29.
  sheet.getColumn(1).width = 11.5;
  sheet.getColumn(2).width = 7.5;
  for (let c = START_COL; c <= globalEndCol; c++) sheet.getColumn(c).width = 4.1;

  type Side = keyof Borders;
  const set = (
    r: number, c: number, v: string,
    fmt?: {
      bg?: string; color?: string; bold?: boolean; size?: number;
      h?: "left" | "center"; vAlign?: "top" | "middle" | "bottom"; wrap?: boolean;
      border?: Partial<Record<Side, Line>>;
    },
  ) => {
    const cell = sheet.getCell(r, c);
    if (v !== "") cell.value = v;
    cell.font = { name: FONT, size: fmt?.size ?? 10, bold: fmt?.bold ?? false, ...(fmt?.color ? { color: { argb: fmt.color } } : {}) };
    cell.alignment = { horizontal: fmt?.h ?? "center", vertical: fmt?.vAlign ?? "middle", wrapText: fmt?.wrap ?? false };
    if (fmt?.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fmt.bg } };
    if (fmt?.border) cell.border = fmt.border as Partial<Borders>;
    return cell;
  };
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r2 > r1 || c2 > c1) sheet.mergeCells(r1, c1, r2, c2);
  };
  const classColStart = (i: number) => START_COL + CLASS_COLS * i;

  let row = 1;
  // ── 제목 + 레벨 범례(C:AP 40열 병합, 상단 1회) ──
  merge(row, START_COL, row, Math.max(globalEndCol, START_COL + 39));
  set(row, START_COL, opts.title ?? "인재원 본원 통합 영어시간표", {
    bg: TITLE_BG, bold: true, size: 25, border: { top: SM, bottom: SS, left: SM, right: SM },
  });
  sheet.getRow(row).height = 32;
  row++;
  merge(row, START_COL, row, Math.max(globalEndCol, START_COL + 39));
  set(row, START_COL, LEVEL_LEGEND, { bg: TITLE_BG, bold: true, size: 9, border: { top: SS, bottom: SM, left: SM, right: SM } });
  sheet.getRow(row).height = 25;
  row++;

  for (const [minStart, classes] of sections) {
    const secRow = row;
    const endCol = START_COL + CLASS_COLS * classes.length - 1;
    // 섹션이 쓰는 교시 index 범위(연속) — min~max.
    let pMin = Infinity, pMax = -1;
    for (const c of classes) for (const pi of c.periodIdx) { pMin = Math.min(pMin, pi); pMax = Math.max(pMax, pi); }
    if (pMax < 0) { pMin = 0; pMax = 0; }
    const sectionPeriods: number[] = [];
    for (let p = pMin; p <= pMax; p++) sectionPeriods.push(p);

    // 1) 반 헤더 (2행×5열) : 반명↵스케줄↵(강사), bg=반색, center-bottom
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      merge(secRow, cs, secRow + 1, cs + CLASS_COLS - 1);
      const teacher = c.teacher ? `(${c.teacher})` : "";
      set(secRow, cs, `${c.className}\n${c.scheduleText}\n${teacher}`, {
        bg: c.bgColor, bold: true, size: 10, vAlign: "bottom", wrap: true,
      });
    });
    sheet.getRow(secRow).height = 26;
    sheet.getRow(secRow + 1).height = 19;

    // 2) 방 행 (1행×5열) bg=반색
    const roomRow = secRow + 2;
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      merge(roomRow, cs, roomRow, cs + CLASS_COLS - 1);
      set(roomRow, cs, c.roomText, { bg: c.bgColor, bold: true, size: 10 });
    });
    sheet.getRow(roomRow).height = 19;

    // 3) 요일 헤더 (월화수목금 개별, 흰색)
    const dayRow = secRow + 3;
    classes.forEach((_, i) => {
      const cs = classColStart(i);
      WEEKDAYS.forEach((d, di) => set(dayRow, cs + di, DAY_KO[d], { size: 10 }));
    });
    sheet.getRow(dayRow).height = 19;

    // 섹션 라벨(A:B, 헤더+방+요일 4행 병합) — 원본 A{sec}:B{sec+3}
    merge(secRow, 1, dayRow, 2);
    set(secRow, 1, `${ampm(minStart)} ${to12(minutesToHM(minStart))}`, { size: 15 });

    // 4) 교시 격자 — A열 시간범위 · B열 교시# · 셀=강사↵↵방 / LAB
    row = dayRow + 1;
    for (const pi of sectionPeriods) {
      const p = periods[pi];
      const pr = row++;
      set(pr, 1, p ? `${to12(minutesToHM(p.start))}~${to12(minutesToHM(p.end))}` : "", { size: 10 });
      set(pr, 2, p?.id ?? String(pi + 1), { size: 12 });
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        WEEKDAYS.forEach((d, di) => {
          const cell = c.cells.get(`${pi}:${d}`);
          if (!cell) { set(pr, cs + di, "", { size: 7 }); return; }
          if (cell.isLab) { set(pr, cs + di, "LAB", { bg: LAB_BG, bold: true, size: 7 }); return; }
          const v = cell.room ? `${cell.teacher}\n\n${cell.room}` : cell.teacher;
          set(pr, cs + di, v, { bg: teacherBg(cell.teacher), color: teacherFg(cell.teacher), size: 7, wrap: true });
        });
      });
      sheet.getRow(pr).height = 19;
    }

    // 5) 명단 (순번 1~11 고정, 초과 시 확장) : 이름 C:E · 학교학년 F:G
    const rosterN = Math.max(11, ...classes.map((c) => c.active.length));
    for (let k = 0; k < rosterN; k++) {
      const rr = row++;
      set(rr, 2, String(k + 1), { size: 9 });
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.active[k];
        merge(rr, cs, rr, cs + NAME_COLS - 1);
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left" });
        merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left" });
      });
      sheet.getRow(rr).height = 19;
    }

    // 6) 정원 (bg #c6d9f0)
    const capRow = row++;
    set(capRow, 2, "정원", { bg: CAP_BG, size: 10 });
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      merge(capRow, cs, capRow, cs + CLASS_COLS - 1);
      set(capRow, cs, c.capacity != null ? String(c.capacity) : "", { bg: CAP_BG, bold: true, size: 10 });
    });

    // 7) 인원
    const cntRow = row++;
    set(cntRow, 2, "인원", { size: 10 });
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      merge(cntRow, cs, cntRow, cs + CLASS_COLS - 1);
      set(cntRow, cs, String(c.active.length), { size: 10 });
    });

    // 8) 대기 (2행 고정, 초과 확장) — B 라벨 병합, 각 행 이름/학교
    const waitN = Math.max(2, ...classes.map((c) => c.hold.length));
    const waitStart = row;
    for (let k = 0; k < waitN; k++) {
      const rr = row++;
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.hold[k];
        merge(rr, cs, rr, cs + NAME_COLS - 1);
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left" });
        merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left" });
      });
    }
    merge(waitStart, 2, row - 1, 2);
    set(waitStart, 2, "대기", { size: 10 });

    // 9) 퇴원생 명단 (3행 고정, 초과 확장)
    const wdN = Math.max(3, ...classes.map((c) => c.withdrawn.length));
    const wdStart = row;
    for (let k = 0; k < wdN; k++) {
      const rr = row++;
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.withdrawn[k];
        merge(rr, cs, rr, cs + NAME_COLS - 1);
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left" });
        merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left" });
      });
    }
    merge(wdStart, 2, row - 1, 2);
    set(wdStart, 2, "퇴원생\n명단", { size: 10, wrap: true });

    // 10) 퇴원수
    const wdcRow = row++;
    set(wdcRow, 2, "퇴원수", { size: 10 });
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      merge(wdcRow, cs, wdcRow, cs + CLASS_COLS - 1);
      set(wdcRow, cs, String(c.withdrawn.length), { size: 10 });
    });

    // ── 테두리 오버레이(섹션 블록) ──
    // A열 = 섹션 좌 외곽 굵은선 / B열 우 얇은선 / 각 반 블록 좌우 굵은선 / 섹션 상하 굵은선.
    for (let r = secRow; r <= wdcRow; r++) {
      applyBorderSide(sheet, r, 1, { left: SM, right: SS });
      applyBorderSide(sheet, r, 2, { right: SM });
      classes.forEach((_, i) => {
        const cs = classColStart(i);
        for (let cc = cs; cc < cs + CLASS_COLS; cc++)
          applyBorderSide(sheet, r, cc, { left: cc === cs ? SM : SS, right: cc === cs + CLASS_COLS - 1 ? SM : SS });
      });
    }
    // 섹션 상단(반헤더 top)·요일헤더 하단·명단 상단·퇴원수 하단 = 굵은 가로선.
    for (let cc = 1; cc <= endCol; cc++) {
      applyBorderSide(sheet, secRow, cc, { top: SM });
      applyBorderSide(sheet, dayRow, cc, { bottom: SM });
      applyBorderSide(sheet, wdcRow, cc, { bottom: SM });
    }

    // 11) 섹션 구분 #999999 회색 2행
    for (let g = 0; g < 2; g++) {
      const gr = row++;
      for (let cc = 1; cc <= endCol; cc++) set(gr, cc, "", { bg: GRAY_BG });
      sheet.getRow(gr).height = g === 0 ? 8 : 8;
    }
  }

  return sheet;
}

/** 기존 셀 테두리를 보존하며 지정한 변(side)만 덮어쓴다(가로/세로 오버레이 충돌 방지). */
function applyBorderSide(
  sheet: Worksheet, r: number, c: number,
  sides: Partial<Record<keyof Borders, Line>>,
) {
  const cell = sheet.getCell(r, c);
  const cur = (cell.border ?? {}) as Partial<Borders>;
  cell.border = { ...cur, ...sides } as Partial<Borders>;
}
