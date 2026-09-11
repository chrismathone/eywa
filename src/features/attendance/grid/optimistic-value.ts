// 출석부 격자 **낙관값** — 타이핑·채우기 값을 저장 전에 칸에 먼저 칠할 값으로(순수, Vitest).
// grid-context의 `toValue`가 이 함수 하나를 쓴다. 서버 저장 규칙과 **같은 답**이어야 한다 — 낙관 덮개는 서버 값과
// 같아질 때만 벗겨져서(store.ts) 틀린 낙관값은 새로고침으로도 안 풀리고 시수 합계에 그대로 남는다.

import { COUNTABLE_STATUSES, isDefaultUnitsRaw } from "../session-units";
import type { GridValue } from "./store";
import type { TypedValue } from "./typing";

/**
 * 이 칸에 아직 **출결 행이 없는가** — 빈 칸, 또는 수업보고서에서 **파생만** 된 칸(`d`, 서버가 준 그대로).
 * 서버는 이런 칸에 저장하면 새 행을 만든다(INSERT) → 수학 자동 시수를 받는다(auto-units.ts).
 * 🔴 상태(`s`)가 보인다고 기록이 있는 게 아니다 — 파생 '출석'은 행이 없다(적대 리뷰 2026-09-11).
 */
export function isRecordless(v: GridValue): boolean {
  return v === null || v.d === true;
}

/**
 * 타이핑 값 → 칸에 보여 줄 값.
 * @param current 이 칸의 **지금** 값(격자 저장소)
 * @param auto 이 반·날짜의 수학 자동 시수(null = 없음 = 1, auto-units.ts)
 * @param slotCount 그날 교시 수(0196a — 둘 이상이면 기본값의 그날 합이 교시 수)
 *
 * ① 행 없는 칸(`isRecordless`) + 숫자 안 고름(원문 공백 — "1"은 명시다, typing.ts) + 시수를 쓰는 상태 →
 *    서버가 넣을 **자동 시수**(원장 2026-09-11 *"그날 수업 길이로 자동"*).
 * ② 친 숫자는 그날 합계 그대로(원장 2026-09-01 *"입력된 숫자가 입력되도록"*) — 1은 null로 접는다
 *    (`parseSessionUnits`와 같은 정규화).
 * ③ 기본(빈칸·1)인데 교시가 여럿이면 "교시마다 1" → 그날 합은 교시 수(원장 확정).
 */
export function optimisticGridValue(
  v: TypedValue | null,
  current: GridValue,
  auto: number | null,
  slotCount: number,
): GridValue {
  if (!v) return null;
  if (auto !== null && isRecordless(current) && isDefaultUnitsRaw(v.units) && COUNTABLE_STATUSES.has(v.status)) {
    return { s: v.status, u: auto };
  }
  const parsed = isDefaultUnitsRaw(v.units) ? null : Number(v.units);
  const raw = parsed === 1 ? null : parsed;
  if (slotCount <= 1 || !COUNTABLE_STATUSES.has(v.status)) return { s: v.status, u: raw };
  if (raw !== null) return { s: v.status, u: raw };
  return { s: v.status, u: slotCount };
}
