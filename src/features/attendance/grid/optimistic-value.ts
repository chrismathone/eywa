// 출석부 격자 **낙관값** — 타이핑·채우기 값을 저장 전에 칸에 먼저 칠할 값으로(순수, Vitest).
// grid-context의 `toValue`가 이 함수 하나를 쓴다. 서버 저장 규칙과 **같은 답**이어야 한다 — 낙관 덮개는 서버 값과
// 같아질 때만 벗겨져서(store.ts) 틀린 낙관값은 새로고침으로도 안 풀리고 시수 합계에 그대로 남는다.

import { COUNTABLE_STATUSES, isDefaultUnitsRaw, parseSessionUnits } from "../session-units";
import type { GridValue } from "./store";

/**
 * 칠할 입력 — 상태 + 시수 **원문**("" = 기본). 격자 타이핑(`TypedValue`, 출석·결석)과 팝오버(지각·조퇴·보강까지)가
 * 같은 모양으로 넘긴다 — 두 경로가 같은 함수로 칠해야 교시 합·자동 시수가 같은 숫자가 된다(리뷰 2026-09-11).
 */
export type OptimisticInput = { status: string; units: string };

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
/**
 * 빗금 칸(`g`)에 상태를 옮길 때 칠할 **표시 전용** 값(원장 2026-09-14 *"그 날의 해당 담당 출석으로 전부 이전"*) — 서버는
 * 다른 선생님 교시 행에 **상태만** 쓰고 시수는 그대로라, 옮긴 뒤 칸 숫자는 들은 상태면 `p`(그 행들 시수 합) · 결석
 * 계열이면 0이다(`ghostGridValue`와 같은 정규화 — 1·0은 null).
 * 🔴 친 숫자(시수)는 칠하지 않는다 — 서버가 안 쓰는 값을 칠하면 새로고침 뒤 숫자가 바뀐다.
 * ⚠️ 빗금 값이 아닌 칸엔 뜻이 없다(null).
 */
export function ghostOptimisticValue(current: GridValue, status: string): GridValue {
  if (!current?.g) return null;
  const p = current.p ?? null;
  return { s: status, u: COUNTABLE_STATUSES.has(status) ? p : null, g: true, p };
}

export function optimisticGridValue(
  v: OptimisticInput | null,
  current: GridValue,
  auto: number | null,
  slotCount: number,
): GridValue {
  if (!v) return null;
  if (auto !== null && isRecordless(current) && isDefaultUnitsRaw(v.units) && COUNTABLE_STATUSES.has(v.status)) {
    return { s: v.status, u: auto };
  }
  // 🔴 원문은 서버와 **같은 함수**(`parseSessionUnits`)로 읽는다 — `Number("1,5")`는 NaN이고, NaN을 칠하면 스냅샷 비교(===)가
  //    영영 같아지지 않아 렌더가 무한히 돌았다(재리뷰 2026-09-11). 서버가 거절할 원문(형식 오류)은 시수를 안 칠한다(null = 1)
  //    — 어떤 호출부도 저장소에 NaN을 못 넣는다. 빈칸은 null, 1도 null로 접힌다(`parseSessionUnits` 규약 그대로).
  const parsed = parseSessionUnits(v.units);
  const raw = parsed.ok ? parsed.value : null;
  if (slotCount <= 1 || !COUNTABLE_STATUSES.has(v.status)) return { s: v.status, u: raw };
  if (raw !== null) return { s: v.status, u: raw };
  return { s: v.status, u: slotCount };
}
