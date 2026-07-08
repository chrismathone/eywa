// 인재원 "통합영어시간표" 형식 그대로 재현하는 exceljs 익스포터(원장 원본 시트 디자인 유지).
// 원본 스펙: scratchpad/injaewon-integrated-spec.md. 화면 미러가 아니라 **인재원 손작업 시트 레이아웃**을 재현.
//   시작시각 섹션 → 반 헤더(반명+스케줄+강사) · 요일별 방 · 요일×40분교시 격자(셀=강사↵방/LAB)
//   · 재원명단(이름(영문)+학교) · 정원/인원(+합계)/대기/퇴원생 명단/퇴원수.
// ⚠️ eywa 미보유 항목(정원=classes.capacity 있으면 채움·없으면 공백 / 수강료·레벨진행표=미지원)은 공백/정적.
import type { Workbook, Worksheet } from "exceljs";
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";
import { type PeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };

const THIN = { style: "thin" as const, color: { argb: "FFAAB2AD" } };
const MEDIUM = { style: "medium" as const, color: { argb: "FF5B6B63" } };

const hhmm = (t: string) => String(t).slice(0, 5);
const toMin = (t: string) => {
  const [h, m] = hhmm(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** "14:20"→"2:20", "09:00"→"9:00" (12시간, 선행0·오전오후 표기 없음 — 원본 표기). */
const to12 = (t: string) => {
  const mm = toMin(t);
  const h = Math.floor(mm / 60);
  const m = mm % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
};

type Cell = { teacher: string; room: string; isLab: boolean };
type ClassInfo = {
  classId: string;
  className: string;
  teacher: string; // 담임(또는 최빈 슬롯강사)
  capacity: number | null;
  minStart: number;
  scheduleText: string; // "월수목 2:20~4:20"
  roomText: string; // "월수 605 / 목 602"
  cells: Map<string, Cell>; // `${periodId}:${day}`
  periodIds: Set<string>;
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
  return [...byRoom.entries()].map(([r, days]) => `${days.map((x) => DAY_KO[x]).join("")} ${r}`).join(" / ");
}

/** 슬롯 → 반 정보 도출. periodOf: 시작시각을 담는 영어 교시 id. */
function buildClassInfos(
  slots: ScheduleSlotWithStudents[],
  config: PeriodsConfig,
  capacityByClassId: Record<string, number | null>,
): ClassInfo[] {
  const table = weekdayTableFor("english", config); // { "1": {startTime,endTime}, ... }
  const periods = Object.entries(table)
    .map(([id, t]) => ({ id, start: toMin(t.startTime), end: toMin(t.endTime) }))
    .sort((a, b) => a.start - b.start);
  const periodOf = (startTime: string): string => {
    const m = toMin(startTime);
    const hit = periods.find((p) => m >= p.start && m < p.end) ?? periods.find((p) => p.start === m);
    return hit?.id ?? periods[0]?.id ?? "1";
  };

  const byClass = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    if (!WEEKDAYS.includes(s.dayOfWeek as Weekday)) continue; // 통합은 평일만
    (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  }

  const out: ClassInfo[] = [];
  for (const [classId, group] of byClass) {
    const first = group[0];
    const cells = new Map<string, Cell>();
    const periodIds = new Set<string>();
    const perDayRooms = new Map<Weekday, Set<string>>();
    const slotTeacherCount = new Map<string, number>();
    let minStart = Infinity;
    let maxEnd = 0;
    const daySet = new Set<Weekday>();
    for (const s of group) {
      const day = s.dayOfWeek as Weekday;
      daySet.add(day);
      const pid = periodOf(s.startTime);
      periodIds.add(pid);
      const isLab = s.slotTeacherLabel === "LAB";
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      const room = s.slotRoomLabel ?? "";
      cells.set(`${pid}:${day}`, { teacher, room, isLab });
      if (s.slotTeacherLabel && !isLab)
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      if (room) (perDayRooms.get(day) ?? perDayRooms.set(day, new Set()).get(day)!).add(room);
      minStart = Math.min(minStart, toMin(s.startTime));
      maxEnd = Math.max(maxEnd, toMin(s.endTime));
    }
    const topSlot = [...slotTeacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const teacher = first.teacherName ?? topSlot ?? "";
    const days = WEEKDAYS.filter((d) => daySet.has(d));
    const scheduleText = `${days.map((d) => DAY_KO[d]).join("")} ${to12(minutesToHM(minStart))}~${to12(minutesToHM(maxEnd))}`;
    const students = first.students;
    out.push({
      classId,
      className: first.className,
      teacher,
      capacity: capacityByClassId[classId] ?? null,
      minStart,
      scheduleText,
      roomText: roomSummary(perDayRooms),
      cells,
      periodIds,
      active: students.filter((s) => s.status === "active"),
      hold: students.filter((s) => s.status === "hold"),
      withdrawn: students.filter((s) => s.status === "withdrawn"),
    });
  }
  return out.sort((a, b) => a.minStart - b.minStart || a.className.localeCompare(b.className, "ko"));
}

function minutesToHM(mm: number): string {
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

const studentName = (s: StudentLine) => (s.englishName ? `${s.name}(${s.englishName})` : s.name);

export type InjaewonSheetOpts = {
  config: PeriodsConfig;
  capacityByClassId?: Record<string, number | null>;
  sheetName?: string;
  title?: string;
};

const LEVEL_LEGEND =
  "※ Class Level : Phonics → Pre Let's → Ready To Talk → Let's Talk → Ready to Speak → Let's Speak → Let's Express → Kopi Wang → Pre Junior → Junior Plus → Senior Plus";

/** 인재원 통합영어시간표 워크시트 추가(원본 형식 재현). */
export function appendInjaewonIntegratedSheet(
  wb: Workbook,
  slots: ScheduleSlotWithStudents[],
  opts: InjaewonSheetOpts,
): Worksheet {
  const table = weekdayTableFor("english", opts.config);
  const periodTime = (id: string) => {
    const t = table[id];
    return t ? `${to12(t.startTime)}~${to12(t.endTime)}` : id;
  };
  const infos = buildClassInfos(slots, opts.config, opts.capacityByClassId ?? {});

  // 섹션 = 반의 최초 시작시각. "오후 H:MM".
  const sectionMap = new Map<number, ClassInfo[]>();
  for (const c of infos) (sectionMap.get(c.minStart) ?? sectionMap.set(c.minStart, []).get(c.minStart)!).push(c);
  const sections = [...sectionMap.entries()].sort((a, b) => a[0] - b[0]);

  const sheet = wb.addWorksheet((opts.sheetName ?? "통합영어시간표").slice(0, 31), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });
  sheet.getColumn(1).width = 8; // 섹션 시각
  sheet.getColumn(2).width = 6; // 행 라벨

  const NAME_COLS = 3; // 반당 이름 열
  const SCHOOL_COLS = 2; // 반당 학교 열
  const CLASS_COLS = NAME_COLS + SCHOOL_COLS; // 5 (월화수목금)

  let maxCol = 2;
  const set = (
    r: number, c: number, v: string,
    fmt?: { bg?: string; color?: string; bold?: boolean; size?: number; align?: "left" | "center"; wrap?: boolean },
  ) => {
    const cell = sheet.getCell(r, c);
    cell.value = v;
    cell.alignment = { horizontal: fmt?.align ?? "center", vertical: "middle", wrapText: fmt?.wrap ?? false };
    cell.font = { bold: fmt?.bold ?? false, size: fmt?.size ?? 10, ...(fmt?.color ? { color: { argb: fmt.color } } : {}) };
    if (fmt?.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fmt.bg } };
    return cell;
  };
  const mergeSet = (r1: number, c1: number, r2: number, c2: number, v: string, fmt?: Parameters<typeof set>[3]) => {
    if (r2 > r1 || c2 > c1) sheet.mergeCells(r1, c1, r2, c2);
    return set(r1, c1, v, fmt);
  };

  let row = 1;
  // ── 타이틀 + 레벨 legend ──
  const titleColsEnd = 2 + Math.max(CLASS_COLS * (sections[0]?.[1].length ?? 8), CLASS_COLS);
  mergeSet(row, 3, row, titleColsEnd, opts.title ?? "인재원 본원 통합 영어시간표", {
    bg: "FF2A322E", color: "FFFFFFFF", bold: true, size: 14,
  });
  sheet.getRow(row).height = 26;
  row++;
  mergeSet(row, 3, row, titleColsEnd, LEVEL_LEGEND, { bg: "FFF3F6F4", size: 9, align: "left" });
  row++;
  row++; // 빈 행

  for (const [minStart, classes] of sections) {
    const startCol = 3;
    const endCol = startCol + CLASS_COLS * classes.length - 1;
    maxCol = Math.max(maxCol, endCol);
    const classColStart = (i: number) => startCol + CLASS_COLS * i;
    const sectionTopRow = row;

    // 1) 반 헤더(2행 병합) : 반명 + 스케줄 + 강사
    const headerRow = row;
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      const teacher = c.teacher ? ` (${c.teacher})` : "";
      mergeSet(headerRow, cs, headerRow + 1, cs + CLASS_COLS - 1, `${c.className} ${c.scheduleText}${teacher}`, {
        bg: "FFE7EFEA", bold: true, size: 10, wrap: true,
      });
    });
    sheet.getRow(headerRow).height = 18;
    sheet.getRow(headerRow + 1).height = 18;
    row += 2;

    // 2) 방 행
    const roomRow = row++;
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      mergeSet(roomRow, cs, roomRow, cs + CLASS_COLS - 1, c.roomText, { size: 9, color: "FF5B6B63", wrap: true });
    });

    // 3) 요일 헤더
    const dayRow = row++;
    classes.forEach((_, i) => {
      const cs = classColStart(i);
      WEEKDAYS.forEach((d, di) => set(dayRow, cs + di, DAY_KO[d], { bg: "FFEEF2F0", bold: true, size: 9 }));
    });

    // 4) 교시 격자 — 섹션 내 반들이 쓰는 교시 union, 시각순.
    const pidSet = new Set<string>();
    for (const c of classes) for (const p of c.periodIds) pidSet.add(p);
    const pids = [...pidSet].sort((a, b) => toMin(table[a]?.startTime ?? "00:00") - toMin(table[b]?.startTime ?? "00:00"));
    for (const pid of pids) {
      const pr = row++;
      set(pr, 1, periodTime(pid), { bg: "FFF7F9F8", size: 8 });
      set(pr, 2, pid, { bg: "FFF7F9F8", bold: true, size: 9 });
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        WEEKDAYS.forEach((d, di) => {
          const cell = c.cells.get(`${pid}:${d}`);
          if (!cell) { set(pr, cs + di, ""); return; }
          if (cell.isLab) { set(pr, cs + di, "LAB", { bg: "FFDBEAFE", color: "FF1D4ED8", bold: true, size: 8 }); return; }
          const v = cell.room ? `${cell.teacher}\n${cell.room}` : cell.teacher;
          set(pr, cs + di, v, { size: 8, wrap: true });
        });
      });
    }

    // 5) 재원 명단 — 반당 이름(3열)+학교(2열). 행수 = 섹션 최대 재원수(최소 1).
    const activeMax = Math.max(1, ...classes.map((c) => c.active.length));
    for (let k = 0; k < activeMax; k++) {
      const rr = row++;
      set(rr, 2, String(k + 1), { size: 8, color: "FF98A29B" });
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.active[k];
        mergeSet(rr, cs, rr, cs + NAME_COLS - 1, s ? studentName(s) : "", { size: 9, align: "left" });
        mergeSet(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1, s ? (s.school ?? "") : "", { size: 8, color: "FF5B6B63" });
      });
    }

    // 6) 정원
    const capRow = row++;
    set(capRow, 2, "정원", { bg: "FFEEF2F0", bold: true, size: 8 });
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      mergeSet(capRow, cs, capRow, cs + CLASS_COLS - 1, c.capacity != null ? String(c.capacity) : "", { size: 9 });
    });

    // 7) 인원(+ 섹션 합계)
    const cntRow = row++;
    set(cntRow, 2, "인원", { bg: "FFEEF2F0", bold: true, size: 8 });
    let sectionTotal = 0;
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      sectionTotal += c.active.length;
      mergeSet(cntRow, cs, cntRow, cs + CLASS_COLS - 1, String(c.active.length), { size: 9, bold: true });
    });
    set(cntRow, endCol + 1, String(sectionTotal), { size: 9, bold: true, color: "FF1D4ED8" });
    maxCol = Math.max(maxCol, endCol + 1);

    // 8) 대기
    const holdMax = Math.max(1, ...classes.map((c) => c.hold.length));
    for (let k = 0; k < holdMax; k++) {
      const rr = row++;
      if (k === 0) set(rr, 2, "대기", { bg: "FFF7E7EC", bold: true, size: 8 });
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.hold[k];
        mergeSet(rr, cs, rr, cs + CLASS_COLS - 1, s ? `${studentName(s)} ${s.school ?? ""}` : "", { size: 8, align: "left" });
      });
    }
    if (holdMax > 1) sheet.mergeCells(cntRow + 1, 2, cntRow + holdMax, 2);

    // 9) 퇴원생 명단
    const wdMax = Math.max(1, ...classes.map((c) => c.withdrawn.length));
    const wdStart = row;
    for (let k = 0; k < wdMax; k++) {
      const rr = row++;
      classes.forEach((c, i) => {
        const cs = classColStart(i);
        const s = c.withdrawn[k];
        mergeSet(rr, cs, rr, cs + CLASS_COLS - 1, s ? `${studentName(s)} ${s.school ?? ""}` : "", { size: 8, align: "left", color: "FF8A948E" });
      });
    }
    mergeSet(wdStart, 2, row - 1, 2, "퇴원생 명단", { bg: "FFEDEFEE", bold: true, size: 8 });

    // 10) 퇴원수
    const wdcRow = row++;
    set(wdcRow, 2, "퇴원수", { bg: "FFEEF2F0", bold: true, size: 8 });
    classes.forEach((c, i) => {
      const cs = classColStart(i);
      mergeSet(wdcRow, cs, wdcRow, cs + CLASS_COLS - 1, String(c.withdrawn.length), { size: 9 });
    });

    // 섹션 시각 라벨(A) — 섹션 전체 세로 병합.
    mergeSet(sectionTopRow, 1, row - 1, 1, `오후 ${to12(minutesToHM(minStart))}`, {
      bg: "FF2A322E", color: "FFFFFFFF", bold: true, size: 11,
    });

    row++; // 섹션 사이 빈 행
    row++;
    // 반별 컬럼 폭
    for (let i = 0; i < classes.length; i++) {
      for (let di = 0; di < CLASS_COLS; di++) sheet.getColumn(classColStart(i) + di).width = 9;
    }
  }

  // 테두리 격자
  const lastRow = row;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const cell = sheet.getCell(r, c);
      if (!cell.border) cell.border = { top: THIN, bottom: THIN, left: c <= 2 ? MEDIUM : THIN, right: THIN };
    }
  }
  return sheet;
}
