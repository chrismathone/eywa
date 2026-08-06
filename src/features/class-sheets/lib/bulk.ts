// 일괄 입력 대상 계산 — 순수 함수(서버·DOM 무관, Vitest로 잠금).
//
// 원스크린 일괄 입력의 계약을 그대로 따른다:
//  · 대상 = **화면에 보이는 그 집합**(이 교시 카드의 로스터). 표시와 일괄 대상이 어긋나면
//    "화면엔 5명인데 8명에게 적용"이 된다.
//  · 🔴 **채우기 기능에 "값이 있어야 통과"하는 게이트를 넣지 말 것** — 정작 채우려던 빈 행이
//    전부 빠져 항상 0건이 되는 사고가 원스크린에서 실제로 났다(grid.ts 교훈).
//  · 읽기 전용 행(기록만 남은 historical·수강 대상 아님)은 제외 — 편집 자체가 막힌 행이다.

/**
 * 상태 제안 칩 — 개별 셀(StatusCell)과 일괄 입력(RosterBulk)이 **같은 어휘**를 제안해야 해서 단일 소스.
 * enum이 아니다(자유 입력 허용 — 운영 어휘 진화). 과목/학년 같은 운영 enum 규칙 대상도 아님.
 */
export const STATUS_CHIPS = ["완", "결석", "안침"] as const;

export type BulkRosterRow = {
  studentId: string;
  /** 이 교시의 수강 대상인가(아니면 입력 불가) */
  eligible: boolean;
  /** 현재 수강 대상은 아니지만 기록이 있어 표시되는 행(읽기 전용) */
  historical: boolean;
};

/** 편집 가능한 행만 — 일괄·개별 공통 전제. */
function editableRows(roster: BulkRosterRow[], canEdit: boolean): BulkRosterRow[] {
  if (!canEdit) return [];
  return roster.filter((r) => r.eligible && !r.historical);
}

/**
 * 일괄 출석 대상 = 편집 가능 + **아직 출결 기록이 없는** 학생.
 * 이미 기록된 학생(출석·결석·지각 등)은 건드리지 않는다 — 출석 쓰기는 비파괴 계약이고
 * (markPresentIfAbsent), 이미 있는 값을 덮으면 출석부 쪽 기록을 앗아간다.
 * 즉 이 일괄은 언제나 "빈 칸만 채우기"라 확인 다이얼로그가 필요 없다.
 */
export function planBulkAttendance(
  roster: BulkRosterRow[],
  /** `${studentId}|${date}` → 출결(값의 모양은 안 본다 — **있으면 건드리지 않는다**가 계약). */
  attendance: Record<string, unknown>,
  date: string,
  opts: { canEdit: boolean; canMarkDate: boolean },
): string[] {
  if (!opts.canMarkDate) return [];
  return editableRows(roster, opts.canEdit)
    .filter((r) => !attendance[`${r.studentId}|${date}`])
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
  return editableRows(roster, opts.canEdit)
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
  return editableRows(roster, canEdit).filter((r) => {
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
  { key: "page_range", label: "페이지" },
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
