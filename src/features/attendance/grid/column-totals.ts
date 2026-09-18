/**
 * 월별 출석부 **합계 행**(원장 2026-09-18 *"가장 하단에 합계 행 하나 추가할것"* · *"청구액, 수업 차수, 등록 차수 합계"* ·
 * *"출석률은 평균으로 합계처리. 각 날짜별로도 차수 합계 나오게"*)의 격자 쪽 집계 — 순수 함수(Vitest).
 *
 * 🔴 시수는 `countCells` **한 곳**에서 센다(행 합계·반 합계·하단 요약과 같은 함수) — 식이 두 벌이면 입력 중엔 A,
 *    새로고침 뒤엔 B로 굳는다. 그래서 서버 첫 렌더와 격자가 **이 함수를 같이** 부른다.
 * 🔴 출석률 합계 = 행 출석률의 **평균**(원장 지시) — 기록이 없는 행(출석률 `—`)은 분모에서 뺀다(0%로 세면 거짓 하락).
 */
import { countCells, ratePercent, type CountedCell } from "./totals";

export type ColumnTotals = {
  /** 수업 차수 합(=행 '수업 차수'의 합). */
  units: number;
  /** 날짜 → 그날 시수 합. 기록이 없는 날은 키가 없다. */
  dayUnits: Record<string, number>;
  /** 행 출석률 평균(정수 %) — 기록 있는 행이 하나도 없으면 null. */
  rateAvg: number | null;
};

export type ColumnTotalsRow = Iterable<readonly [date: string, cell: CountedCell]>;

export function columnTotals(rows: Iterable<ColumnTotalsRow>): ColumnTotals {
  let units = 0;
  const byDay = new Map<string, CountedCell[]>();
  const rates: number[] = [];
  for (const row of rows) {
    const cells: CountedCell[] = [];
    for (const [date, cell] of row) {
      cells.push(cell);
      const list = byDay.get(date);
      if (list) list.push(cell);
      else byDay.set(date, [cell]);
    }
    const c = countCells(cells);
    units += c.units;
    const r = ratePercent(c);
    if (r !== null) rates.push(r);
  }
  const dayUnits: Record<string, number> = {};
  for (const [date, cells] of byDay) {
    const u = countCells(cells).units;
    if (u > 0) dayUnits[date] = u;
  }
  return {
    units: Math.round(units * 10) / 10,
    dayUnits,
    rateAvg: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
  };
}
