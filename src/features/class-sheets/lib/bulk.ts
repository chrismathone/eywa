// 일괄 입력 대상 계산 — 순수 함수(서버·DOM 무관, Vitest로 잠금).
//
// 원스크린 일괄 입력의 계약을 그대로 따른다:
//  · 대상 = **화면에 보이는 그 집합**(이 교시 카드의 로스터). 표시와 일괄 대상이 어긋나면
//    "화면엔 5명인데 8명에게 적용"이 된다.
//  · 🔴 **채우기 기능에 "값이 있어야 통과"하는 게이트를 넣지 말 것** — 정작 채우려던 빈 행이
//    전부 빠져 항상 0건이 되는 사고가 원스크린에서 실제로 났다(grid.ts 교훈).
//  · 읽기 전용 행(기록만 남은 historical·수강 대상 아님)은 제외 — 편집 자체가 막힌 행이다.

export type BulkRosterRow = {
  studentId: string;
  /** 이 교시의 수강 대상인가(아니면 입력 불가) */
  eligible: boolean;
  /** 보강(수업외) — 수강행 없이 그날 출결. 태도 일괄은 연다(출결 일괄은 이미 칸이 있어 빠진다). */
  isMakeup?: boolean;
  /** 현재 수강 대상은 아니지만 기록이 있어 표시되는 행(읽기 전용) */
  historical: boolean;
};

/** 태도·마크 일괄 — 보강도 연다(출결은 이미 있어서 출석 일괄에는 안 넣는다). */
function editableMarkRows(roster: BulkRosterRow[], canEdit: boolean): BulkRosterRow[] {
  if (!canEdit) return [];
  return roster.filter((r) => (r.eligible || r.isMakeup) && !r.historical);
}

/** 출결 일괄 — 보강은 이미 칸이 있다. 빈 칸으로 보면 makeup을 present로 덮는다. */
function editableAttendanceRows(roster: BulkRosterRow[], canEdit: boolean): BulkRosterRow[] {
  if (!canEdit) return [];
  return roster.filter((r) => r.eligible && !r.historical && !r.isMakeup);
}

/**
 * 일괄 출석 대상 = 편집 가능 + **아직 출결 기록이 없는** 학생.
 * 이미 기록된 학생(출석·결석·지각 등)은 건드리지 않는다 — 출석 쓰기는 비파괴 계약이고
 * (markPresentIfAbsent), 이미 있는 값을 덮으면 출석부 쪽 기록을 앗아간다.
 * 즉 이 일괄은 언제나 "빈 칸만 채우기"라 확인 다이얼로그가 필요 없다.
 */
export function planBulkAttendance(
  roster: BulkRosterRow[],
  /** `${studentId}|${date}|${slotStart}` → 출결(값의 모양은 안 본다 — **있으면 건드리지 않는다**가 계약). */
  attendance: Record<string, unknown>,
  date: string,
  /** 이 교시(0196a) — 빈 칸 판정은 **그 교시 기준**이다(같은 날 다른 교시가 찍혔어도 여긴 빈 칸). */
  slotStart: string,
  opts: { canEdit: boolean; canMarkDate: boolean },
): string[] {
  if (!opts.canMarkDate) return [];
  return editableAttendanceRows(roster, opts.canEdit)
    .filter((r) => !attendance[`${r.studentId}|${date}|${slotStart}`])
    .map((r) => r.studentId);
}

/**
 * 일괄 상태 대상. `onlyEmpty`면 상태가 비어 있는 행만(이미 입력한 값 보존).
 * onlyEmpty=false는 **강사가 방금 고른 값**을 넣는 것이라 덮어쓰기가 기본이지만,
 * 덮일 값이 있으면 호출부가 확인을 받는다(planBulkStatus는 계산만 한다).
 */
export function planBulkStatus(
  roster: BulkRosterRow[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  slotStart: string,
  opts: { canEdit: boolean; onlyEmpty: boolean },
): string[] {
  return editableMarkRows(roster, opts.canEdit)
    .filter((r) => {
      if (!opts.onlyEmpty) return true;
      const cur = marks[`${r.studentId}|${date}|${slotStart}`]?.status ?? null;
      return cur === null || cur === "";
    })
    .map((r) => r.studentId);
}

/** 덮어쓰기로 사라질 값의 개수 — 확인 문구에 실수를 밝히기 위한 계산(침묵 금지). */
export function countStatusOverwrites(
  roster: BulkRosterRow[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  slotStart: string,
  canEdit: boolean,
): number {
  return editableMarkRows(roster, canEdit).filter((r) => {
    const cur = marks[`${r.studentId}|${date}|${slotStart}`]?.status ?? null;
    return cur !== null && cur !== "";
  }).length;
}

// ── 수업계획(평시/내신) 일괄 입력 ──────────────────────────────────────────────
// 원장 2026-08-06: *"평시/내신 일괄입력 기능도 같이 추가."* 6영역(보카·리딩…) 줄에 같은 교재·같은 과제를
// 하나씩 타이핑하던 것을 한 번에. 로스터 일괄과 **같은 계약**을 따른다:
//  · 대상 = 그 카드에 **이미 있는** 줄뿐 — 여기서 줄을 새로 만들지 않는다("+ 줄 추가"가 구조 변경 RPC라
//    일괄이 몰래 행을 늘리면 다른 사람 화면과 줄 수가 갈린다). 줄이 없으면 대상 0건으로 정직하게 막는다.
//  · 덮어쓰기가 기본이되 덮일 값의 **개수를 밝히고** 확인을 받는다. '빈 칸만 채우기'면 확인 불필요.
//  · 진도/과제는 줄마다 다를 수 있으니 **어느 칸에 넣을지 사람이 고른다**(전 칸 동시 채우기 없음).

/** 일괄로 채울 수 있는 계획 칸 — 구분(skill_area)은 줄의 정체라 제외(바꾸면 다른 영역 줄이 된다). */
export const PLAN_BULK_FIELDS = [
  { key: "textbook", label: "교재" },
  { key: "page_range", label: "시간" }, // 라벨만 — 저장 컬럼은 page_range 그대로(2026-08-11)
  { key: "progress", label: "진도" },
  { key: "homework", label: "과제" },
] as const;
export type PlanBulkField = (typeof PLAN_BULK_FIELDS)[number]["key"];

export type BulkPlanRow = {
  id: string;
  termMode: "regular" | "exam";
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

const PLAN_FIELD_VALUE: Record<PlanBulkField, (l: BulkPlanRow) => string | null> = {
  textbook: (l) => l.textbook,
  page_range: (l) => l.pageRange,
  progress: (l) => l.progress,
  homework: (l) => l.homework,
};

/** 그 시기(평시/내신)의 줄만 — 표시 순서 그대로. */
export function planLinesOfTerm(
  lines: readonly BulkPlanRow[],
  termMode: "regular" | "exam",
  canEdit: boolean,
): BulkPlanRow[] {
  if (!canEdit) return [];
  return lines.filter((l) => l.termMode === termMode);
}

/**
 * 일괄로 채울 줄의 id. `onlyEmpty`면 그 칸이 비어 있는 줄만(이미 쓴 값 보존).
 * ⚠️ 원스크린 교훈(bulk.ts 머리 주석 🔴)대로 **"값이 있어야 통과"하는 게이트를 넣지 않는다** —
 *    정작 채우려던 빈 줄이 전부 빠져 항상 0건이 되는 사고가 실제로 났다.
 */
export function planBulkPlanCells(
  lines: readonly BulkPlanRow[],
  termMode: "regular" | "exam",
  field: PlanBulkField,
  opts: { canEdit: boolean; onlyEmpty: boolean },
): string[] {
  const read = PLAN_FIELD_VALUE[field];
  return planLinesOfTerm(lines, termMode, opts.canEdit)
    .filter((l) => !opts.onlyEmpty || isBlank(read(l)))
    .map((l) => l.id);
}

/** 덮어쓰기로 사라질 계획 칸의 개수 — 상태 일괄과 같은 이유로 숫자를 밝힌다(침묵 금지). */
export function countPlanCellOverwrites(
  lines: readonly BulkPlanRow[],
  termMode: "regular" | "exam",
  field: PlanBulkField,
  canEdit: boolean,
): number {
  const read = PLAN_FIELD_VALUE[field];
  return planLinesOfTerm(lines, termMode, canEdit).filter((l) => !isBlank(read(l))).length;
}

/** 공백만 있는 칸은 빈 칸으로 본다(plan-codec의 저장 규약 — trim 후 빈 문자열은 NULL). */
function isBlank(v: string | null): boolean {
  return v === null || v.trim() === "";
}

// ── 하루 단위 일괄 ────────────────────────────────────────────────────────────
// 🔴 버튼이 **요일 머리**로 올라갔다(원장 2026-08-14: *"가장 위의 수업에만 있으면 됨. 아래까지 필요없음"*
//    → *"생각해보니까 요일 옆에 넣어도 될듯. 어차피 일괄이니까"*). 교시 카드마다 같은 버튼 셋이 반복돼
//    시끄러웠고, 정작 사람이 하려는 일은 "그 날 전부"라 요일이 맞는 단위다.
// ⚠️ 대상은 그래도 **교시별로** 계산한다 — 로스터·기록이 교시마다 다르다(같은 날 4교시엔 찍혔고
//    6교시엔 안 찍힌 학생이 흔하다). 그래서 반환도 교시별 묶음이고 저장도 교시별로 나간다
//    (0196a: 출결·태도의 저장 축이 교시다 — 여기서 뭉치면 다른 교시 기록을 덮는다).

export type DayBulkSlot = {
  slotStart: string;
  roster: BulkRosterRow[];
  lines: BulkPlanRow[];
  /** 그 날 실제로 열린 교시인가 — 시간표에 없는 칸은 아예 대상이 아니다(개별 셀도 잠겨 있다). */
  scheduled: boolean;
};

/** 교시별 대상 묶음 — 저장이 교시 단위라 평평한 id 목록으로 뭉개지 않는다. */
export type DayBulkTarget = { slotStart: string; studentIds: string[] };

/** 대상 칸 수 — 같은 학생이 두 교시면 2로 센다(찍히는 칸이 곧 일감이라 사람이 기대하는 수). */
export function countDayTargets(targets: readonly DayBulkTarget[]): number {
  return targets.reduce((n, t) => n + t.studentIds.length, 0);
}

const openSlots = (slots: readonly DayBulkSlot[]) => slots.filter((s) => s.scheduled);

/** 하루치 일괄 출석 대상 — 교시별 빈 칸의 합. 대상이 0인 교시는 빠진다. */
export function planDayBulkAttendance(
  slots: readonly DayBulkSlot[],
  attendance: Record<string, unknown>,
  date: string,
  opts: { canEdit: boolean; canMarkDate: boolean },
): DayBulkTarget[] {
  return openSlots(slots)
    .map((s) => ({
      slotStart: s.slotStart,
      studentIds: planBulkAttendance(s.roster, attendance, date, s.slotStart, opts),
    }))
    .filter((t) => t.studentIds.length > 0);
}

/** 하루치 일괄 태도 대상 — 교시별 합(`onlyEmpty`면 빈 칸만). */
export function planDayBulkStatus(
  slots: readonly DayBulkSlot[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  opts: { canEdit: boolean; onlyEmpty: boolean },
): DayBulkTarget[] {
  return openSlots(slots)
    .map((s) => ({
      slotStart: s.slotStart,
      studentIds: planBulkStatus(s.roster, marks, date, s.slotStart, opts),
    }))
    .filter((t) => t.studentIds.length > 0);
}

/** 하루치 태도 덮어쓰기 개수 — 확인 문구의 숫자. */
export function countDayStatusOverwrites(
  slots: readonly DayBulkSlot[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  canEdit: boolean,
): number {
  return openSlots(slots).reduce(
    (n, s) => n + countStatusOverwrites(s.roster, marks, date, s.slotStart, canEdit),
    0,
  );
}

/** 하루치 계획 줄 id — 줄 id는 교시와 무관하게 유일하므로 평평하게 합쳐도 된다. */
export function planDayBulkPlanCells(
  slots: readonly DayBulkSlot[],
  termMode: "regular" | "exam",
  field: PlanBulkField,
  opts: { canEdit: boolean; onlyEmpty: boolean },
): string[] {
  return openSlots(slots).flatMap((s) => planBulkPlanCells(s.lines, termMode, field, opts));
}

/** 하루치 계획 줄 수(그 시기) — 0이면 "줄이 없습니다"로 정직하게 막는다. */
export function countDayTermLines(
  slots: readonly DayBulkSlot[],
  termMode: "regular" | "exam",
  canEdit: boolean,
): number {
  return openSlots(slots).reduce((n, s) => n + planLinesOfTerm(s.lines, termMode, canEdit).length, 0);
}

/** 하루치 계획 덮어쓰기 개수. */
export function countDayPlanCellOverwrites(
  slots: readonly DayBulkSlot[],
  termMode: "regular" | "exam",
  field: PlanBulkField,
  canEdit: boolean,
): number {
  return openSlots(slots).reduce(
    (n, s) => n + countPlanCellOverwrites(s.lines, termMode, field, canEdit),
    0,
  );
}

// ── 일괄 라벨의 **범위** 표기 ──────────────────────────────────────────────────
// 🔴 원장 2026-08-18: *"학생수는 6인데 일괄출석은 12"* → *"수업 개수가 곱해져서 12구나. 그럼 이렇게.
//    **일괄 출석 학생수x수업수 로 표기, 합산하지 말고**."*
//    그전 라벨은 `countDayTargets`(=빈 칸의 합)를 그대로 적어서, 학생 6명만 보고 있는 사람에게 12가
//    어디서 왔는지 화면 어디에도 안 나왔다. 이제 라벨은 **범위**(6×3)를 말하고, 실제로 몇 칸이 기록됐는지는
//    누른 뒤 토스트가 말한다(둘은 다를 수 있다 — 일괄 출석은 빈 칸만 채우기 때문).
// ⚠️ **저장 대상 산출(`countDayTargets`·`planDayBulkAttendance`)은 손대지 않는다** — 그쪽이 맞다.
//    여기 있는 건 오로지 라벨 표기다(2026-08-14 "라벨 숫자는 칸 수" 결정이 이 지시로 뒤집혔다).

/**
 * 일괄 대상 **학생 수** — 편집 가능한(재원) 학생을 교시 간 **중복 없이** 센다.
 * 퇴원·기록·보강은 출석 일괄에서 뺀다(보강은 이미 칸이 있다).
 */
export function countDayBulkStudents(
  slots: readonly DayBulkSlot[],
  opts: { canEdit: boolean },
): number {
  const ids = new Set<string>();
  for (const s of openSlots(slots)) {
    for (const r of editableAttendanceRows(s.roster, opts.canEdit)) ids.add(r.studentId);
  }
  return ids.size;
}

/** 그 날 **예정된(scheduled) 교시 수** — 시간표에 없는 칸은 애초에 일괄 대상이 아니다. */
export function countDayOpenSlots(slots: readonly DayBulkSlot[]): number {
  return openSlots(slots).length;
}

/**
 * 라벨에 붙는 범위 표기 — `6×3`(학생수 × 교시수). **곱한 값을 적지 않는다**(그게 혼란의 원인이었다).
 * 둘 중 하나라도 0이면 빈 문자열 — 그 경우 버튼은 어차피 비활성이고, `0×3`은 읽을 값이 아니다.
 */
export function bulkScopeLabel(studentCount: number, slotCount: number): string {
  if (studentCount <= 0 || slotCount <= 0) return "";
  return `${studentCount}×${slotCount}`;
}
