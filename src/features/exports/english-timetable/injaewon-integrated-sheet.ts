// 인재원 "통합영어시간표(7월)" 원본 손작업 서식으로 렌더하되, **섹션 그룹핑/순서/교시축은 앱 통합뷰와
// 동일**(buildRichCardGroups 재사용 = "N교시 시작"별 그룹, 카드 가나다). "통합뷰를 그대로 뱉어낸다".
//   상단 제목(25pt bg#efefef) + 레벨 범례
//   섹션(N교시 시작) = 반헤더(3줄: 반명↵스케줄↵(강사), bg=반색) · 방행(classroomLabel) · 요일헤더
//     · 교시격자(A열 시간범위·B열 교시#·셀="강사↵↵방" bg=강사색·LAB) · 명단(신입생→신규생→재원생, 가나다)
//     · 정원/인원/대기/퇴원생 명단/퇴원수 · 섹션 사이 #999999 회색 2행.
// 데이터/색/정렬 디테일은 수학 익스포터·화면 통합뷰와 일관(formatSchoolGrade·상태색·rosterRank·메모).
import type { Workbook, Worksheet, Borders } from "exceljs";
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";
import { type PeriodsConfig, slotPeriodRow, enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import {
  buildRichCardGroups,
  type GridSlot,
  type IntegrationGroupsConfig,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { readableTextColor } from "@/lib/color-utils";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import type { TeacherGeometry } from "./teacher-grid-sheet";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
type Weekday = (typeof WEEKDAYS)[number];

const FONT = "Arial";
const TITLE_BG = "FFEFEFEF";
const CAP_BG = "FFC6D9F0";
const LAB_BG = "FFDAEEF3";
const GRAY_BG = "FF999999";
const PASTELS = ["FFBBDEFB", "FFC8E6C9", "FFFFE0B2", "FFF8BBD0", "FFD1C4E9", "FFB2EBF2", "FFFFF9C4", "FFD7CCC8"];

type Line = { style: "medium" | "thin"; color: { argb: string } };
const SM: Line = { style: "medium", color: { argb: "FF000000" } };
const SS: Line = { style: "thin", color: { argb: "FF000000" } };

const hhmm = (t: string) => String(t).slice(0, 5);
const toMin = (t: string) => {
  const [h, m] = hhmm(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** "14:20"→"2:20"(12시간, 선행0 없음 — 원본 표기). */
const to12 = (t: string) => {
  const mm = toMin(t);
  const h = Math.floor(mm / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm % 60).padStart(2, "0")}`;
};
/** "14:20~15:00" → "2:20~3:00". */
const timeRange12 = (t: string) => t.split("~").map(to12).join("~");
/** "본원602" → "602"(공통 접두 제거). class-grid shortRoom과 동일. */
const shortRoom = (room: string) => room.replace(/^본원/, "") || room;

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
/** 1-based 열 번호 → 엑셀 열 문자(3→"C"). */
const colLetter = (n: number): string => {
  let x = "", k = n;
  while (k > 0) { x = String.fromCharCode(65 + ((k - 1) % 26)) + x; k = Math.floor((k - 1) / 26); }
  return x;
};
/**
 * 방 행 수식(구글시트 전용) — 원본 1-rxc의 방-집계 LET/LAMBDA를 이 블록의 실제 행/열로 재현.
 * 블록의 미니그리드(요일×교시, "강사↵↵방")에서 방번호(3자리/SKY)를 요일별로 추출·집계해 "월수 602 / 목 605".
 * 원본은 ROW()/COLUMN() 상대참조라 고정 레이아웃 가정 → 여기선 동적 레이아웃이라 상수로 박아 넣는다.
 */
function roomFormula(headerRow: number, blockCol: number, gridStart: number, gridEnd: number): string {
  return (
    `IFNA(LET(헤더행,${headerRow},블록열,${blockCol},데이터시작행,${gridStart},데이터끝행,${gridEnd},` +
    `PROCESS_COLUMN,LAMBDA(컬럼오프셋,LET(` +
    `요일라벨,TRIM(TO_TEXT(INDIRECT(ADDRESS(헤더행+3,블록열+컬럼오프셋,4)))),` +
    `범위,INDIRECT(ADDRESS(데이터시작행,블록열+컬럼오프셋,4)&":"&ADDRESS(데이터끝행,블록열+컬럼오프셋,4)),` +
    `extracted,MAP(범위,LAMBDA(cell,IFERROR(REGEXEXTRACT(TO_TEXT(cell),"\\b(\\d{3}|SKY)\\b")))),` +
    `uniques,UNIQUE(TOCOL(extracted,1)),joined,TEXTJOIN("-",1,uniques),` +
    `IF(AND(joined<>"",LEN(요일라벨)>0),요일라벨&" "&joined,""))),` +
    `initial_results,MAP(SEQUENCE(5,1,0),LAMBDA(o,PROCESS_COLUMN(o))),` +
    `final_results,IFERROR(FILTER(initial_results,initial_results<>""),""),` +
    `IF(COUNTA(final_results)=0,"",LET(` +
    `unique_classrooms,UNIQUE(MAP(final_results,LAMBDA(x,IFERROR(REGEXEXTRACT(x,"\\s(.+)"),"")))),` +
    `grouped_results,MAP(unique_classrooms,LAMBDA(cr,LET(` +
    `days,FILTER(final_results,REGEXMATCH(final_results,"\\s"&cr&"$")),` +
    `day_headers,MAP(days,LAMBDA(y,IFERROR(REGEXEXTRACT(y,"(.+?)\\s"),""))),` +
    `TEXTJOIN("",1,day_headers)&" "&cr))),TEXTJOIN(" / ",1,grouped_results)))),"")`
  );
}

/**
 * **단일 균등 조회 수식**(구글시트 전용, 스마트 동기화) — 원본의 "하나의 수식이 모든 미니그리드에 균등하게
 * 작동" 설계를 eywa 동적 레이아웃에 재현. **모든 미니그리드 칸(빈 칸 포함)에 동일 문자열**을 넣고, 각 셀이
 * `ROW()`/`COLUMN()`로 자기 위치를 파악한다:
 *  - `헤더행` = 섹션 경계 래더(ROW()→섹션 헤더행). eywa 실제 섹션 행을 상수로 구움.
 *  - `블록열` = INT((COLUMN()-3)/5)*5+3 (5열 블록).
 *  - `수업명` = 블록 헤더 첫 줄(자기 위치에서 읽음 → 통합 헤더 반명 바꾸면 따라옴).
 *  - `일레이블` = 요일행에서 이 열의 요일.
 *  - `r1/r2` = ROW()→강사별 행범위 래더(사전계산). `열들/강사들` = 요일→강사별 열/강사 스위치.
 * 그 뒤 강사별을 역조회(반명 매칭)해 강사+방 도출. 강사별 셀 포맷 "반명↵방": 첫 줄=반명, 마지막 줄=방.
 */
function buildUniformFormula(
  sectionRows: number[],
  rowRange: Map<number, [number, number]>,
  geometry: TeacherGeometry,
): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const sheet = geometry.sheetName.replace(/'/g, "''");
  // 섹션 래더: ROW() → 헤더행(secRow). 구간 [sec_k, sec_{k+1}) → sec_k, 마지막은 TRUE.
  const secs = [...sectionRows].sort((a, b) => a - b);
  const secLadder = secs.map((s, i) => (i < secs.length - 1 ? `ROW()<${secs[i + 1]},${s}` : `TRUE,${s}`)).join(",");
  // r1/r2 래더: ROW() → 강사별 행범위(teacherRowRange 사전계산). 미니그리드 아닌 행은 0.
  const rrs = [...rowRange.entries()].sort((a, b) => a[0] - b[0]);
  const r1Ladder = rrs.map(([gr, [r1]]) => `${gr},${r1}`).join(",");
  const r2Ladder = rrs.map(([gr, [, r2]]) => `${gr},${r2}`).join(",");
  // 요일 → 강사별 열들·강사들. ⚠️ **SWITCH 금지** — Google Sheets SWITCH는 배열 반환값을 스칼라(첫 원소)로
  // 뭉개서 열이 하나로 축소된다(검색 전멸). **중첩 IF는 배열을 보존**하므로 IF로 짠다.
  const days: { ko: string; day: DayOfWeek }[] = [
    { ko: "월", day: "mon" }, { ko: "화", day: "tue" }, { ko: "수", day: "wed" }, { ko: "목", day: "thu" }, { ko: "금", day: "fri" },
  ];
  const dayCells: { key: string; cols: string; teachers: string }[] = [];
  for (const { ko, day } of days) {
    const cols = geometry.dayColumns[day];
    if (!cols || !cols.length) continue;
    dayCells.push({ key: q(ko), cols: cols.map((c) => q(c.colLetter)).join(";"), teachers: cols.map((c) => q(c.teacher)).join(";") });
  }
  const colSwitch = dayCells.reduceRight((acc, d) => `IF(일레이블=${d.key},{${d.cols}},${acc})`, `{""}`);
  const teachSwitch = dayCells.reduceRight((acc, d) => `IF(일레이블=${d.key},{${d.teachers}},${acc})`, `{""}`);
  return (
    `IFERROR(LET(` +
    `헤더행,SWITCH(TRUE,${secLadder}),` +
    `블록열,INT((COLUMN()-3)/5)*5+3,` +
    `수업명,IFERROR(TRIM(REGEXEXTRACT(TO_TEXT(INDIRECT(ADDRESS(헤더행,블록열,4))),"^[^\\n]+")),""),` +
    `일레이블,TRIM(TO_TEXT(INDIRECT(ADDRESS(헤더행+3,COLUMN(),4)))),` +
    // ⚠️ LET 변수명에 `r1`/`r2` 금지 — LAMBDA 안에서 셀 참조 R1/R2로 오인돼 #NAME?(→IFERROR가 삼켜 "").
    // 한글명(시작행/끝행)은 셀 참조와 안 겹쳐 LAMBDA 클로저로 정상 접근된다.
    `시작행,SWITCH(ROW(),${r1Ladder},0),끝행,SWITCH(ROW(),${r2Ladder},0),` +
    `열들,${colSwitch},강사들,${teachSwitch},` +
    `IF(OR(수업명="",시작행=0),"",LET(` +
    `히트,MAP(열들,강사들,LAMBDA(cl,tn,IF(cl="","",LET(` +
    `범위,INDIRECT("'${sheet}'!"&cl&시작행&":"&cl&끝행),` +
    `매치들,MAP(범위,LAMBDA(x,IF(IFERROR(TRIM(REGEXEXTRACT(TO_TEXT(x),"^[^\\n]+"))=수업명,FALSE),TO_TEXT(x),""))),` +
    `셀,IFERROR(TEXTJOIN("",TRUE,FILTER(매치들,LEN(매치들)>0)),""),` +
    `방,IFERROR(REGEXEXTRACT(셀,"\\n\\s*([^\\n]+)$"),""),` +
    `IF(LEN(셀)>0,tn&"‖"&방,""))))),` +
    `유효,IFERROR(FILTER(히트,LEN(히트)>0),""),` +
    `강사,IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(BYROW(유효,LAMBDA(x,IFERROR(REGEXEXTRACT(x,"^[^‖]+"),""))))),""),` +
    `방,IFERROR(REGEXEXTRACT(INDEX(유효,1,1),"‖(.*)$"),""),` +
    `IF(LEN(강사)=0,"",IF(LEN(방)=0,강사,강사&CHAR(10)&CHAR(10)&방))` +
    `))` +
    `),"")`
  );
}

/** 통합 교시(pr.time "HH:MM~HH:MM")를 강사별 시각행 범위 [r1,r2]로 매핑. 겹치는 행 없으면 null. */
function teacherRowRange(geometry: TeacherGeometry, timeRange: string): [number, number] | null {
  const [s, e] = timeRange.split("~");
  const startMin = toMin(s), endMin = toMin(e);
  const within = geometry.rows.filter((r) => r.startMin >= startMin && r.startMin < endMin);
  if (within.length > 0) return [within[0].row, within[within.length - 1].row];
  const exact = geometry.rows.find((r) => r.startMin === startMin); // 경계 미정렬 폴백
  return exact ? [exact.row, exact.row] : null;
}

const studentName = (s: StudentLine) => (s.englishName ? `${s.name}(${s.englishName})` : s.name);
// 학교+학년 = 수학과 동일 공용 헬퍼(빈값 "-"·레벨/숫자 추출). 순서만 numberLast:true("종로초2") — 통합 원본 표기.
const schoolGrade = (s: StudentLine) => formatSchoolGrade(s.school, s.grade, { numberLast: true });
const dayCompact = (days: Weekday[]) => (days.length === 5 ? "매일" : days.map((d) => enumDayToKo(d)).join(""));

const MS_DAY = 86400000;
/** 학생 상태색 — 수학과 동일: 반이동 초록·신입생(30일) 빨강·신규생(60일) 분홍. refMs=기준 월요일. */
function studentStatusStyle(s: StudentLine, refMs: number): { bg: string; fg: string; bold: boolean } {
  if (s.isTransferredIn) return { bg: "FFBBF7D0", fg: "FF111827", bold: true };
  if (s.enrollmentDate) {
    const days = Math.ceil((refMs - new Date(s.enrollmentDate).getTime()) / MS_DAY);
    if (days <= 30) return { bg: "FFEF4444", fg: "FFFFFFFF", bold: true }; // 신입생
    if (days <= 60) return { bg: "FFFCE7F3", fg: "FF111827", bold: true }; // 신규생
  }
  return { bg: "FFFFFFFF", fg: "FF111827", bold: false }; // 재원생
}
/** 재원 명단 배치 — 신입생(30일)→신규생(60일)→재원생, 각 그룹 가나다. */
function rosterRank(s: StudentLine, refMs: number): number {
  if (s.enrollmentDate) {
    const days = Math.ceil((refMs - new Date(s.enrollmentDate).getTime()) / MS_DAY);
    if (days <= 30) return 0;
    if (days <= 60) return 1;
  }
  return 2;
}
/** 셀 메모(교재/진도) — 수학 buildStudentMemoText 형식. */
function studentMemo(s: StudentLine): string | null {
  const parts: string[] = [];
  if (s.latestTextbook?.name) parts.push(`교재: ${s.latestTextbook.name}`);
  const rep = s.latestReport;
  if (rep?.progress) {
    const d = rep.date;
    const label = d && /^\d{4}-\d{2}-\d{2}/.test(d) ? ` ${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}` : "";
    parts.push(`[진도]${label}\n${rep.progress}`);
  }
  return parts.length ? parts.join("\n────────\n") : null;
}

export type InjaewonSheetOpts = {
  config: PeriodsConfig;
  capacityByClassId?: Record<string, number | null>;
  teacherColors?: TeacherColorMap;
  referenceDate?: string; // 기준 월요일(YYYY-MM-DD) — 신입/퇴원 윈도우. 미지정=오늘.
  compactSections?: Set<number>; // '1시간 단위' 압축 섹션(sectionKey) — 화면 통합뷰 토글과 동일.
  /** 통합뷰 커스텀 그룹(학원설정 과목별) — 화면과 같은 섹션 배치로 뽑기 위해 그대로 전달받는다. */
  customGroups?: IntegrationGroupsConfig | null;
  // 제공 시 수식 셀을 여기 수집(셀엔 정적 값을 씀). ⚠️ xlsx에 구글 수식(LET/LAMBDA)을 넣으면 xlsx→시트
  // 변환이 통째로 실패("Conversion not supported")하므로, 수식은 업로드 후 Sheets API로 별도 주입한다.
  formulaSink?: FormulaCell[];
  // 제공 시 미니그리드 셀을 **강사별 탭 역조회 수식**으로 생성(스마트 동기화). 강사별을 편집하면 통합이
  // 따라온다. formulaSink(구글시트 API 후주입)와 함께 있을 때만 동작 — xlsx엔 정적 값 유지.
  teacherGeometry?: TeacherGeometry;
  sheetName?: string;
  title?: string;
};

/** 시트 API 후처리로 주입할 수식 셀(1-based row/col). */
export type FormulaCell = { row: number; col: number; formula: string };

const LEVEL_LEGEND =
  "※ Class Level : Phonics → Pre Let's → Ready To Talk → Let's Talk → Ready to Speak → Let's Speak → Let's Express → Kopi Wang → Pre Junior → Junior Plus → Senior Plus";

const CLASS_COLS = 5; // 월화수목금
const NAME_COLS = 3; // 이름 병합(C:E)
const START_COL = 3; // 첫 반 블록 시작(C)

/** 반의 스케줄 요약 "매일 2:20~5:40" — 카드 셀/교시에서 요일·시간범위 도출. */
function scheduleTextOf(card: RichClassCard): string {
  const daySet = new Set<Weekday>();
  for (const k of Object.keys(card.cells)) {
    const d = k.split(":")[1] as Weekday;
    if (WEEKDAYS.includes(d)) daySet.add(d);
  }
  const days = WEEKDAYS.filter((d) => daySet.has(d));
  const prs = [...card.periodRows].sort((a, b) => a.order - b.order);
  const start = prs[0]?.time.split("~")[0] ?? "";
  const end = prs[prs.length - 1]?.time.split("~")[1] ?? "";
  return `${dayCompact(days)} ${start ? to12(start) : ""}~${end ? to12(end) : ""}`;
}

/** 인재원 통합영어시간표 워크시트 — 앱 통합뷰(buildRichCardGroups) 그룹핑을 인재원 서식으로 렌더. */
export function appendInjaewonIntegratedSheet(
  wb: Workbook,
  slots: ScheduleSlotWithStudents[],
  opts: InjaewonSheetOpts,
): Worksheet {
  const refMs = opts.referenceDate ? new Date(opts.referenceDate).getTime() : Date.now();
  const formulaSink = opts.formulaSink;
  const geometry = opts.teacherGeometry;
  const teacherColors = opts.teacherColors ?? {};
  const teacherBg = (label: string): string => {
    const c = teacherColors[label]?.bg;
    return c ? hexToARGB(c) : PASTELS[hashIdx(label, PASTELS.length)];
  };
  const teacherFg = (label: string): string => {
    const t = teacherColors[label]?.text;
    const bg = teacherColors[label]?.bg;
    if (t) return hexToARGB(t, "FF000000");
    if (bg) return hexToARGB(readableTextColor(bg), "FF000000");
    return "FF000000";
  };

  // 앱 통합뷰와 동일 그룹핑/순서/교시축/요일축(N교시 시작, 카드 가나다).
  const groups = buildRichCardGroups(
    slots as unknown as GridSlot[],
    opts.config,
    opts.compactSections ?? new Set(),
    opts.customGroups,
  ).filter(
    (g) => g.days.some((d) => WEEKDAYS.includes(d as Weekday)),
  );
  // 셀별 방(인재원 셀 "강사↵↵방") — buildRichCardGroups는 방을 헤더로만 집계하므로 order 키로 별도 매핑.
  const roomByCell = new Map<string, string>();
  for (const s of slots) {
    if (!WEEKDAYS.includes(s.dayOfWeek as Weekday)) continue;
    const order = slotPeriodRow("english", s.startTime, s.dayOfWeek as DayOfWeek, opts.config).order;
    const room = s.slotRoomLabel ?? "";
    if (room) roomByCell.set(`${s.classId}:${order}:${s.dayOfWeek}`, shortRoom(room));
  }
  const capacityByClassId = opts.capacityByClassId ?? {};

  const maxCards = Math.max(1, ...groups.map((g) => g.cards.length));
  const globalEndCol = START_COL + CLASS_COLS * maxCards - 1;

  const sheet = wb.addWorksheet((opts.sheetName ?? "통합영어시간표").slice(0, 31), { views: [{ state: "normal" }] });
  sheet.getColumn(1).width = 11.5;
  sheet.getColumn(2).width = 7.5;
  for (let c = START_COL; c <= globalEndCol; c++) sheet.getColumn(c).width = 4.1;

  type Side = keyof Borders;
  const set = (
    r: number, c: number, v: string,
    fmt?: {
      bg?: string; color?: string; bold?: boolean; size?: number;
      h?: "left" | "center"; vAlign?: "top" | "middle" | "bottom"; wrap?: boolean;
      border?: Partial<Record<Side, Line>>; note?: string; formula?: string;
    },
  ) => {
    const cell = sheet.getCell(r, c);
    if (v !== "") cell.value = v; // xlsx엔 항상 정적 값(수식은 아래 sink로 별도 수집).
    if (fmt?.formula && formulaSink) formulaSink.push({ row: r, col: c, formula: fmt.formula });
    cell.font = { name: FONT, size: fmt?.size ?? 10, bold: fmt?.bold ?? false, ...(fmt?.color ? { color: { argb: fmt.color } } : {}) };
    cell.alignment = { horizontal: fmt?.h ?? "center", vertical: fmt?.vAlign ?? "middle", wrapText: fmt?.wrap ?? false };
    if (fmt?.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fmt.bg } };
    if (fmt?.border) cell.border = fmt.border as Partial<Borders>;
    if (fmt?.note) cell.note = fmt.note;
    return cell;
  };
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r2 > r1 || c2 > c1) sheet.mergeCells(r1, c1, r2, c2);
  };
  const classColStart = (i: number) => START_COL + CLASS_COLS * i;

  let row = 1;
  // ── 제목 + 레벨 범례 ──
  merge(row, START_COL, row, Math.max(globalEndCol, START_COL + 39));
  set(row, START_COL, opts.title ?? "인재원 본원 통합 영어시간표", { bg: TITLE_BG, bold: true, size: 25, border: { top: SM, bottom: SS, left: SM, right: SM } });
  sheet.getRow(row).height = 32;
  row++;
  merge(row, START_COL, row, Math.max(globalEndCol, START_COL + 39));
  set(row, START_COL, LEVEL_LEGEND, { bg: TITLE_BG, bold: true, size: 9, border: { top: SS, bottom: SM, left: SM, right: SM } });
  sheet.getRow(row).height = 25;
  row++;

  // 균등 조회 수식용 수집: 미니그리드 전 칸 위치 + 섹션 헤더행(래더) + ROW()→강사별 행범위(래더).
  const miniCells: { row: number; col: number }[] = [];
  const sectionRows: number[] = [];
  const rowRange = new Map<number, [number, number]>();

  for (const group of groups) {
    const cards = group.cards;
    const endCol = START_COL + CLASS_COLS * cards.length - 1;
    const pRows = [...group.periodRows].sort((a, b) => a.order - b.order);
    const secRow = row;
    sectionRows.push(secRow);

    // 1) 반 헤더(2행×5열) : 반명↵스케줄↵(강사), bg=반색
    cards.forEach((c, i) => {
      const cs = classColStart(i);
      merge(secRow, cs, secRow + 1, cs + CLASS_COLS - 1);
      const teacher = c.teacherName ? `(${c.teacherName})` : "";
      set(secRow, cs, `${c.className}\n${scheduleTextOf(c)}\n${teacher}`, {
        bg: hexToARGB(c.bgColor, PASTELS[hashIdx(c.classId, PASTELS.length)]), bold: true, size: 10, vAlign: "bottom", wrap: true,
      });
    });
    sheet.getRow(secRow).height = 26;
    sheet.getRow(secRow + 1).height = 19;

    // 2) 방 행 — classroomLabel(정적) / 구글시트는 미니그리드 방번호 파생 수식(원본 재현).
    const roomRow = secRow + 2;
    const gridStart = secRow + 4; // 첫 교시 행(dayRow+1)
    const gridEnd = secRow + 3 + pRows.length; // 마지막 교시 행
    cards.forEach((c, i) => {
      const cs = classColStart(i);
      merge(roomRow, cs, roomRow, cs + CLASS_COLS - 1);
      set(roomRow, cs, c.classroomLabel, {
        bg: hexToARGB(c.bgColor, PASTELS[hashIdx(c.classId, PASTELS.length)]), bold: true, size: 10,
        formula: roomFormula(secRow, cs, gridStart, gridEnd),
      });
    });
    sheet.getRow(roomRow).height = 19;

    // 3) 요일 헤더(월화수목금)
    const dayRow = secRow + 3;
    cards.forEach((_, i) => {
      const cs = classColStart(i);
      WEEKDAYS.forEach((d, di) => set(dayRow, cs + di, enumDayToKo(d), { size: 10 }));
    });
    sheet.getRow(dayRow).height = 19;

    // 섹션 라벨(A:B 4행 병합) — 앱 통합뷰 라벨 그대로("N교시 시작")
    merge(secRow, 1, dayRow, 2);
    set(secRow, 1, group.label, { size: 15 });

    // 4) 교시 격자 — A열 시간범위 · B열 교시# · 셀=강사↵↵방 / LAB (교시축·순서 = 통합뷰 group.periodRows)
    row = dayRow + 1;
    for (const pr of pRows) {
      const gr = row++;
      set(gr, 1, timeRange12(pr.time), { size: 10 });
      set(gr, 2, pr.label.replace("교시", ""), { size: 12 });
      // ROW()→강사별 행범위(균등수식 래더용).
      if (geometry) { const range = teacherRowRange(geometry, pr.time); if (range) rowRange.set(gr, range); }
      cards.forEach((c, i) => {
        const cs = classColStart(i);
        WEEKDAYS.forEach((d, di) => {
          // 모든 미니그리드 칸(빈 칸 포함)에 균등 조회수식 — 위치만 수집, 수식은 루프 후 일괄 주입.
          if (geometry && formulaSink) miniCells.push({ row: gr, col: cs + di });
          const cell = c.cells[`${pr.order}:${d}`];
          if (!cell) { set(gr, cs + di, "", { size: 7 }); return; }
          // 특수 자리(LAB·JJ)는 사람이 아니라 방이라 강사색 대신 고정색. 두 자리는 라벨로 구분된다.
          if (cell.isLab) { set(gr, cs + di, cell.label, { bg: LAB_BG, bold: true, size: 7 }); return; }
          const rm = roomByCell.get(`${c.classId}:${pr.order}:${d}`) ?? "";
          set(gr, cs + di, rm ? `${cell.label}\n\n${rm}` : cell.label, { bg: teacherBg(cell.label), color: teacherFg(cell.label), size: 7, wrap: true });
        });
      });
      sheet.getRow(gr).height = 19;
    }
    const periodEnd = row - 1;

    // 카드별 재원 배치(신입생→신규생→재원생, 가나다) — card.active는 런타임 StudentLine.
    const activeByCard = cards.map((c) =>
      (c.active as unknown as StudentLine[]).slice().sort((a, b) => rosterRank(a, refMs) - rosterRank(b, refMs) || a.name.localeCompare(b.name, "ko")),
    );
    const holdByCard = cards.map((c) => c.hold as unknown as StudentLine[]);
    const weekEndMs = refMs + 6 * MS_DAY;
    const wdByCard = cards.map((c) =>
      (c.withdrawn as unknown as StudentLine[]).filter((s) => !s.endDate || Math.floor((weekEndMs - new Date(s.endDate).getTime()) / MS_DAY) <= 30),
    );

    // 5) 명단 (순번 1~11 고정, 초과 확장) : 이름 C:E · 학교학년 F:G, 상태색+메모
    const rosterN = Math.max(11, ...activeByCard.map((a) => a.length));
    const rosterStart = row;
    for (let k = 0; k < rosterN; k++) {
      const rr = row++;
      set(rr, 2, String(k + 1), { size: 9 });
      cards.forEach((_, i) => {
        const cs = classColStart(i);
        const s = activeByCard[i][k];
        const st = s ? studentStatusStyle(s, refMs) : null;
        const fill = st && st.bg !== "FFFFFFFF" ? { bg: st.bg } : {};
        const memo = s ? studentMemo(s) : null;
        if (s) merge(rr, cs, rr, cs + NAME_COLS - 1); // 빈 슬롯은 병합 안 함(병합 총량이 시트 변환 한계 초과 방지)
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left", ...fill, color: st?.fg, bold: st?.bold, ...(memo ? { note: memo } : {}) });
        if (s) merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left", ...fill, color: st?.fg, bold: st?.bold });
      });
      sheet.getRow(rr).height = 19;
    }
    const rosterEnd = row - 1;

    // 6) 정원
    const capRow = row++;
    set(capRow, 2, "정원", { bg: CAP_BG, size: 10 });
    cards.forEach((c, i) => {
      const cs = classColStart(i);
      const cap = capacityByClassId[c.classId];
      merge(capRow, cs, capRow, cs + CLASS_COLS - 1);
      set(capRow, cs, cap != null ? String(cap) : "", { bg: CAP_BG, bold: true, size: 10 });
    });

    // 7) 인원
    const cntRow = row++;
    set(cntRow, 2, "인원", { size: 10 });
    cards.forEach((_, i) => {
      const cs = classColStart(i);
      merge(cntRow, cs, cntRow, cs + CLASS_COLS - 1);
      set(cntRow, cs, String(activeByCard[i].length), { size: 10, formula: `COUNTA(${colLetter(cs)}${rosterStart}:${colLetter(cs)}${rosterEnd})` });
    });

    // 8) 대기(2행 고정, 초과 확장)
    const waitN = Math.max(2, ...holdByCard.map((h) => h.length));
    const waitStart = row;
    for (let k = 0; k < waitN; k++) {
      const rr = row++;
      cards.forEach((_, i) => {
        const cs = classColStart(i);
        const s = holdByCard[i][k];
        if (s) merge(rr, cs, rr, cs + NAME_COLS - 1);
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left" });
        if (s) merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left" });
      });
    }
    const waitEnd = row - 1;
    merge(waitStart, 2, row - 1, 2);
    set(waitStart, 2, "대기", { size: 10 });

    // 9) 퇴원생 명단(3행 고정, 초과 확장) — 퇴원생 셀 = 검은 배경·흰 글씨·볼드(사용자 지정).
    const wdN = Math.max(3, ...wdByCard.map((w) => w.length));
    const wdStart = row;
    for (let k = 0; k < wdN; k++) {
      const rr = row++;
      cards.forEach((_, i) => {
        const cs = classColStart(i);
        const s = wdByCard[i][k];
        const wf = s ? { bg: "FF000000", color: "FFFFFFFF", bold: true } : {};
        if (s) merge(rr, cs, rr, cs + NAME_COLS - 1);
        set(rr, cs, s ? studentName(s) : "", { size: 9, h: "left", ...wf });
        if (s) merge(rr, cs + NAME_COLS, rr, cs + CLASS_COLS - 1);
        set(rr, cs + NAME_COLS, s ? schoolGrade(s) : "", { size: 9, h: "left", ...wf });
      });
    }
    merge(wdStart, 2, row - 1, 2);
    set(wdStart, 2, "퇴원생\n명단", { size: 10, wrap: true });

    // 10) 퇴원수
    const wdEnd = row - 1;
    const wdcRow = row++;
    set(wdcRow, 2, "퇴원수", { size: 10 });
    cards.forEach((_, i) => {
      const cs = classColStart(i);
      merge(wdcRow, cs, wdcRow, cs + CLASS_COLS - 1);
      set(wdcRow, cs, String(wdByCard[i].length), { size: 10, formula: `COUNTA(${colLetter(cs)}${wdStart}:${colLetter(cs)}${wdEnd})` });
    });

    // A열(시간범위 축)은 교시 구간에서만 행마다 값이 있다. 그 아래(명단·정원/인원·대기·퇴원)는 늘 빈
    // 칸이라 행마다 쪼개진 빈 셀이 사다리처럼 쌓였다 → **구간별 1칸으로 병합**(원장 지시 2026-07-23,
    // 원본 시트와 동일한 모양). merge()는 1행짜리 구간이면 아무것도 안 하므로 그대로 호출해도 안전.
    merge(rosterStart, 1, rosterEnd, 1);
    merge(capRow, 1, cntRow, 1);
    merge(waitStart, 1, waitEnd, 1);
    merge(wdStart, 1, wdEnd, 1);

    // ── 테두리: 얇은 격자 + 구조 굵은선. 미니그리드·학생 명단은 내부선 없음(외부 위주) ──
    const inList = (r: number) =>
      (r >= rosterStart && r <= rosterEnd) || (r >= waitStart && r <= waitEnd) || (r >= wdStart && r <= wdEnd);
    for (let r = secRow; r <= wdcRow; r++) {
      const inMiniGrid = r > dayRow && r <= periodEnd;
      const listRow = inList(r);
      for (let c = 1; c <= endCol; c++) {
        if (inMiniGrid && c >= START_COL) continue;
        // 명단(재원·대기·퇴원)은 **내부 테두리 전부 없음**(원장 지시 2026-07-23). 이름↔학교학년 세로선과
        // 행 사이 가로선이 촘촘해 이름이 잘 안 읽혔다 — 구분은 상태 배경색·굵기가 이미 하고 있다.
        // 카드 좌우 굵은선과 구간 경계 가로선은 아래 두 루프가 따로 그리므로 블록 경계는 안 흐려진다.
        // (전엔 '빈 셀만' 건너뛰어, 학생이 있는 칸에만 격자가 남아 들쭉날쭉했다.)
        if (listRow && c >= START_COL) continue;
        applyBorderSide(sheet, r, c, { top: SS, bottom: SS, left: SS, right: SS });
      }
    }
    for (let r = secRow; r <= wdcRow; r++) {
      applyBorderSide(sheet, r, 1, { left: SM });
      applyBorderSide(sheet, r, endCol, { right: SM });
      cards.forEach((_, i) => {
        const cs = classColStart(i);
        applyBorderSide(sheet, r, cs, { left: SM });
        applyBorderSide(sheet, r, cs + CLASS_COLS - 1, { right: SM });
      });
    }
    // 가로 굵은선: 섹션 상단·요일↔교시·교시↔명단·명단↔정원·정원↔인원·인원↔대기·대기↔퇴원명단·섹션 하단.
    for (let cc = 1; cc <= endCol; cc++) {
      applyBorderSide(sheet, secRow, cc, { top: SM });
      applyBorderSide(sheet, dayRow, cc, { bottom: SM });
      applyBorderSide(sheet, periodEnd, cc, { bottom: SM });
      applyBorderSide(sheet, capRow, cc, { top: SM });
      applyBorderSide(sheet, cntRow, cc, { top: SM });
      applyBorderSide(sheet, waitStart, cc, { top: SM });
      applyBorderSide(sheet, wdStart, cc, { top: SM });
      applyBorderSide(sheet, wdcRow, cc, { bottom: SM });
    }

    // 11) 섹션 구분 #999999 회색 2행
    for (let g = 0; g < 2; g++) {
      const gr = row++;
      for (let cc = 1; cc <= endCol; cc++) set(gr, cc, "", { bg: GRAY_BG });
      sheet.getRow(gr).height = 8;
    }
  }

  // 균등 조회 수식: 섹션 경계·행범위·요일열을 상수로 구운 **단일 문자열**을 전 미니그리드 칸에 동일 주입.
  // 각 셀이 ROW()/COLUMN()로 자기 위치를 파악 → 원본의 "하나의 수식이 모든 미니그리드에 균등 작동" 재현.
  if (geometry && formulaSink && miniCells.length) {
    const uniform = buildUniformFormula(sectionRows, rowRange, geometry);
    for (const mc of miniCells) formulaSink.push({ row: mc.row, col: mc.col, formula: uniform });
  }

  return sheet;
}

/** 기존 셀 테두리를 보존하며 지정한 변만 덮어쓴다. */
function applyBorderSide(sheet: Worksheet, r: number, c: number, sides: Partial<Record<keyof Borders, Line>>) {
  const cell = sheet.getCell(r, c);
  const cur = (cell.border ?? {}) as Partial<Borders>;
  cell.border = { ...cur, ...sides } as Partial<Borders>;
}
