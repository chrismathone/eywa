/**
 * **신규생 케어 칸** — 운영실 한 화면과 신규생 목록이 **같은 조건**으로 세고 거르는 단일 소스(순수·Vitest).
 *
 * 외부 PRD(부록A)의 `NEW STUDENT CARE 90` 줄을 우리 재료로 옮긴 것이다. 이름을 '90'으로 부르지 않는 이유:
 * 🔴 **90일짜리 물건이 아직 아니다** — 체크리스트는 1개월 콜에서 끝나고(3개월 콜은 창만 있고 업무 기록이
 *    없다) 입학테스트 일정·예약은 표 자체가 없다. 그래서 칸은 **실제로 사람이 하는 다섯 절차**뿐이다.
 *
 * 🔴 **판정을 여기서 새로 하지 않는다** — [`statusOf`](./onboarding-items)를 그대로 부른다. 기한 계산을
 *    복제하면 신규생 목록과 운영실이 다른 수를 말한다(기준일이 둘이라 특히 갈리기 쉽다: 창은 등록일,
 *    콜은 첫 수업일).
 * 🔴 **숫자를 센 조건 = 눌렀을 때의 필터**다. 두 곳이 이 파일의 `careCellMatches` 하나를 부르므로
 *    "12건이라더니 목록엔 9명"이 원리적으로 안 생긴다.
 * 🔴 `waived`(기능 시작 전 기한)는 미완료가 **아니다** — `statusOf`가 이미 갈라 놓았고 여기서 되살리지 말 것.
 * 🔴 `progressOf`(진행률)를 미완료 수처럼 쓰지 말 것 — 그건 분모가 다른 물건이다.
 */

import {
  NEWCOMER_BASELINE_DATE,
  ONBOARDING_ITEMS,
  daysLeftOf,
  statusOf,
  type OnboardingItemDef,
} from "./onboarding-items";

/**
 * 칸으로 세우는 절차 다섯. 🔴 **`month3_call`(3개월 콜)은 뺀다** — 창만 있고 그 케어를 기록하는 업무가
 * 아직 없어서, 세워 두면 아무도 손댈 수 없는 숫자가 된다. `month2_call`은 '필요시'라 원래 대상 밖이다.
 */
export const CARE_ITEM_KEYS = [
  "pre_call",
  "first_class_guide",
  "ojt",
  "after_first_call",
  "month1_call",
] as const;

/** 첫 수업일이 없어 **기한 시계가 아직 안 도는** 등록생 — 날짜 계산에서 조용히 빠지는 사람들이다. */
export const NO_FIRST_CLASS_CELL = "no_first_class";

export type CareCellDef =
  | { key: string; label: string; kind: "item"; item: OnboardingItemDef }
  | { key: typeof NO_FIRST_CLASS_CELL; label: string; kind: "noFirstClass" };

const ITEM_BY_KEY = new Map(ONBOARDING_ITEMS.map((i) => [i.key, i]));

/** 🔴 라벨은 `ONBOARDING_ITEMS.shortLabel`에서만 온다 — 여기서 새 이름을 지어내지 말 것. */
export const CARE_CELLS: readonly CareCellDef[] = [
  ...CARE_ITEM_KEYS.map((key) => {
    const item = ITEM_BY_KEY.get(key);
    // 항목 키가 바뀌면 조용히 칸이 사라지는 대신 바로 터뜨린다(라벨을 지어내지 않기 위한 대가).
    if (!item) throw new Error(`care-cells: 알 수 없는 신규생 항목 키 "${key}"`);
    return { key, label: item.shortLabel, kind: "item" as const, item };
  }),
  { key: NO_FIRST_CLASS_CELL, label: "첫수업일 미정", kind: "noFirstClass" as const },
];

export function careCellByKey(key: string): CareCellDef | null {
  return CARE_CELLS.find((c) => c.key === key) ?? null;
}

/** 이 칸이 필요한 학생 한 명분 — 신규생 조회(`NewcomerRow`)가 그대로 들어맞는 최소 모양. */
export type CareRow = {
  enrolledOn: string;
  /** 첫 수업일 — 모르면 null. */
  firstClassOn: string | null;
  checks: Readonly<Record<string, string | null | undefined>>;
};

/**
 * 그 학생이 이 칸에 **들어가는가** = 미완료(기한 지남 또는 오늘·사흘 안).
 * 🔴 운영실 숫자와 목록 필터가 **이 함수 하나**를 공유한다.
 */
export function careCellMatches(
  cell: CareCellDef,
  row: CareRow,
  today: string,
  baseline: string = NEWCOMER_BASELINE_DATE,
): boolean {
  if (cell.kind === "noFirstClass") return row.firstClassOn === null;
  const status = statusOf(
    cell.item,
    { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn },
    row.checks[cell.key],
    today,
    baseline,
  );
  // done·upcoming·pending·waived는 "지금 할 일"이 아니다.
  return status === "overdue" || status === "due";
}

/** 그 칸에서 이 학생이 **지연**인가(색과 보조 숫자를 정한다). 첫수업일 미정 칸엔 지연 개념이 없다. */
export function careCellOverdue(
  cell: CareCellDef,
  row: CareRow,
  today: string,
  baseline: string = NEWCOMER_BASELINE_DATE,
): boolean {
  if (cell.kind === "noFirstClass") return false;
  return (
    statusOf(
      cell.item,
      { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn },
      row.checks[cell.key],
      today,
      baseline,
    ) === "overdue"
  );
}

export type CareCellCount = {
  key: string;
  label: string;
  kind: CareCellDef["kind"];
  /** 미완료 **학생 수**(오늘 기한 도래 + 지연). 🔴 코호트 총원이 아니다. */
  count: number;
  /** 그중 기한이 지난 사람 수 — 색은 이 값만 본다. */
  overdue: number;
  /** 🔴 색은 **지연이 있을 때만** 붙는다(색 = 의미). 0이면 조용히. */
  tone: "critical" | "caution" | "inert";
};

export function buildCareCells(
  rows: readonly CareRow[],
  today: string,
  baseline: string = NEWCOMER_BASELINE_DATE,
): CareCellCount[] {
  return CARE_CELLS.map((cell) => {
    let count = 0;
    let overdue = 0;
    for (const row of rows) {
      if (!careCellMatches(cell, row, today, baseline)) continue;
      count += 1;
      if (careCellOverdue(cell, row, today, baseline)) overdue += 1;
    }
    return {
      key: cell.key,
      label: cell.label,
      kind: cell.kind,
      count,
      overdue,
      // 첫수업일 미정은 '지연'이 아니라 '확인 필요'라 주의색까지만 간다.
      tone: overdue > 0 ? "critical" : count > 0 ? "caution" : "inert",
    };
  });
}

/** 남은 날(음수 = 지남). 첫수업일 미정 칸·기한 미상이면 null. */
export function careCellDaysLeft(cell: CareCellDef, row: CareRow, today: string): number | null {
  if (cell.kind === "noFirstClass") return null;
  return daysLeftOf(cell.item, { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn }, today);
}

/** 목록 화면의 `?item=` 값 → 칸. 모르는 값이면 필터를 안 건다(빈 목록보다 전체가 낫다). */
export function parseCareCellParam(raw: string | undefined | null): CareCellDef | null {
  return raw ? careCellByKey(raw) : null;
}
