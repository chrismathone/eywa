// 주간 그리드의 **행 배치 전략** — 순수 함수(Vitest로 잠금).
//
// **서수 배치 단일 전략**: 각 요일의 N번째 수업이 N행(빈 공백 없음). 요일 안 슬롯은 buildWeekGrid가
// 시각순으로 정렬해 주므로 열 안의 순서는 언제나 시각순이다.
//
// 이력 — "같은 교시(slotStart)를 요일 간 같은 행에"(구글시트 원본의 가로 정렬)가 원안이었으나 두 번 무너졌다:
//  ① 주말 수업은 평일보다 훨씬 이른 시각이라(주말 3교시 15:40 vs 평일 9교시 19:20) 시각 정렬이 평일 열과
//     주말 열을 서로 다른 행 구간으로 밀어내 **거대한 빈 공백**(원장 제보 2026-07-29 → 혼합 주만 서수 배치,
//     원장 승인 "주말수업이 있는 경우 그냥 평일수업처럼 같은 위치에 배정해도 괜찮겠어").
//  ② "평일끼리는 교시 시간표를 공유해 정렬이 의미 있다"던 가정도 실반에서 깨졌다 — 중등E_초등 브릿지 B는
//     화·금 둘째 수업이 16:00, 수요일만 15:40이라 15:40이 행 하나를 통째로 차지해 **화·금에 수요일 카드
//     높이만큼 공백**(원장 제보 2026-08-17: "왜 붙어있지 않고 공간이 있지"). → 시각 정렬 폐기, 서수 단일화.
// ⚠️ 시각 정렬 재도입 금지 — 요일 간 시각이 갈라지는 반이 실재하는 한 같은 공백이 재발한다.
import type { GridDay, GridSlot } from "./grid";

/** 한 행 = 요일 인덱스별 슬롯(그 요일에 해당 슬롯이 없으면 null = 빈 칸). */
export type GridRow = (GridSlot | null)[];

const WEEKEND = new Set(["sat", "sun"]);

/** 토·일 판정 — 행 배치와 무관하게 서버(queries/today/seat-day)가 주말 교시표 분기에 쓴다. */
export function isWeekendDow(dow: string): boolean {
  return WEEKEND.has(dow);
}

/**
 * 행렬 생성 = **서수 배치**. 각 요일의 i번째 수업이 i행 — 수업 카드가 위로 붙어 열에 공백이 없다.
 * 반환값의 길이 = 행 수(가장 수업 많은 요일), 각 행의 길이 = `days.length`(열 수)로 항상 일치한다.
 */
export function buildGridRows(days: GridDay[]): GridRow[] {
  if (days.length === 0) return [];
  const rowCount = Math.max(...days.map((d) => d.slots.length));
  return Array.from({ length: rowCount }, (_, i) => days.map((d) => d.slots[i] ?? null));
}
