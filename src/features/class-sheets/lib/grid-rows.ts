// 주간 그리드의 **행 배치 전략** — 순수 함수(Vitest로 잠금).
//
// 기본은 "같은 교시(slotStart)를 요일 간 같은 행에" (구글시트 원본의 가로 정렬). 그런데 주말 수업은
// 평일보다 훨씬 이른 시각에 시작해서(주말 3교시 15:40 vs 평일 9교시 19:20), 시각 기준으로 줄을 맞추면
// **평일 열과 주말 열이 서로 다른 행 구간을 차지해 양쪽에 거대한 빈 공백**이 생긴다(원장 제보 2026-07-29:
// 수/일이 같이 보일 때 한 열이 통째로 비어 보임).
//
// → **평일과 주말이 섞여 보일 때는 시각 정렬을 포기하고 N번째 수업끼리 같은 행에 배치**한다
//   (원장 승인: "주말수업이 있는 경우 그냥 평일수업처럼 같은 위치에 배정해도 괜찮겠어").
//   같은 종류(평일만/주말만)일 때는 기존 시각 정렬을 유지 — 그 안에선 교시 시간표가 공유돼 정렬이 의미 있다.
import type { GridDay, GridSlot } from "./grid";

/** 한 행 = 요일 인덱스별 슬롯(그 요일에 해당 슬롯이 없으면 null = 빈 칸). */
export type GridRow = (GridSlot | null)[];

const WEEKEND = new Set(["sat", "sun"]);

export function isWeekendDow(dow: string): boolean {
  return WEEKEND.has(dow);
}

/** 평일과 주말이 함께 보이는가 — 행 배치 전략을 가르는 유일한 조건. */
export function hasMixedDayKinds(days: Pick<GridDay, "dow">[]): boolean {
  let weekday = false;
  let weekend = false;
  for (const d of days) {
    if (isWeekendDow(d.dow)) weekend = true;
    else weekday = true;
    if (weekday && weekend) return true;
  }
  return false;
}

/**
 * 행렬 생성. 반환값의 길이 = 행 수, 각 행의 길이 = `days.length`(열 수)로 항상 일치한다.
 * - 혼합(평일+주말): **서수 배치** — 각 요일의 i번째 수업이 i행. 빈 공백 없음.
 * - 단일 종류: **시각 배치** — slotStart 합집합 정렬(없는 요일은 빈 칸).
 *   ⚠️ slotStart는 DB time 컬럼에서 온 zero-padded "HH:MM"이라 사전순 정렬 = 시각순.
 */
export function buildGridRows(days: GridDay[]): GridRow[] {
  if (days.length === 0) return [];

  if (hasMixedDayKinds(days)) {
    const rowCount = Math.max(...days.map((d) => d.slots.length));
    return Array.from({ length: rowCount }, (_, i) => days.map((d) => d.slots[i] ?? null));
  }

  const starts = new Set<string>();
  for (const day of days) for (const slot of day.slots) starts.add(slot.slotStart);
  return [...starts]
    .sort()
    .map((start) => days.map((d) => d.slots.find((s) => s.slotStart === start) ?? null));
}
