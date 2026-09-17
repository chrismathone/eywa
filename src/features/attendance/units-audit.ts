/**
 * 출결 저장 감사로그의 **"시수 3 → 1.5"** — 순수 함수(Vitest).
 *
 * 원장 2026-09-14: *"출결 감사로그에서 값을 얼마에서 얼마로 바꿨는지, 예) 3 -> 1.5 이렇게 추가"* ·
 * *"수치가 필요한 감사로그는 그에 걸맞게 값도 추가"*.
 *
 * 🔴 **재는 대상은 "이 저장이 시수를 정한 행"뿐이다.** 그날 칸은 배분 계획(`planDayCellUnits`)의 수신 행,
 *    교시 지정 저장은 대표 1행이다. 호출부가 그 집합을 골라 넘긴다 — 여기서 다시 고르지 않는다.
 * 🔴 **숫자는 화면 값과 같은 뜻**이어야 한다(원장이 본 칸의 숫자가 3이었다): 그래서 결석·공결은
 *    시수가 얼마로 적혀 있든 **0**으로 센다(`consumedUnits`, 화면 `rollupDay`와 같은 규약).
 *    행 값을 그대로 더하면 "출석 1 + 결석 1 = 2"라는, 화면 어디에도 없는 숫자가 로그에 남는다.
 * ⚠️ **안 바뀐 저장은 null**이다 — 같은 값 재저장까지 "3 → 3"으로 적으면 평시 로그가 길어져 진짜 정정이 묻힌다.
 */
import { consumedUnits, type AttendanceMark } from "./cell-display";
import { COUNTABLE_STATUSES, round1 } from "./session-units";

/** 시수를 재는 행 한 줄 — DB에서 읽은 그대로(`status`는 문자열, `units`는 null이면 기본 1). */
export type UnitsAuditRow = { status: string; units: number | null };

/** 달라졌을 때만 값이 있다. null = 적을 것이 없다(시수 불변). */
export type UnitsAudit = { prevUnits: number; nextUnits: number } | null;

/**
 * 친 값이 행들에 **어떻게 담기나** — 저장 갈래마다 다르고, 틀리면 칸 숫자가 절반이나 두 배가 된다.
 * · `"split"` = 그날 칸(`slot === null`). 배분 계획이 친 값을 교시별로 **나눠** 담아 합이 정확히 친 값이다.
 * · `"each"` = 교시 지정 저장(ECS). 대상 행 **전부에 같은 값**을 쓴다(`patch.session_units`) — 대상이
 *   "그 교시 + 옛 그날 전체 행"이면 월간 격자가 두 행을 합산하므로(`rollupDay`는 slot 키로 가른다) 칸은 2배가 된다.
 */
export type UnitsSpread = "split" | "each";

/**
 * @param rows 이 저장이 **시수를 정한** 행들의 저장 전 모습.
 * @param status 이번에 찍는 상태(결석이면 칸 숫자가 0이 된다).
 * @param unitsVal 사람이 친 값 — `null` = 교시마다 기본(1) · 숫자 = 친 값.
 * @param spread 그 값이 행들에 나뉘어 담기나(`split`) 행마다 똑같이 담기나(`each`).
 */
export function unitsAuditFields(input: {
  rows: readonly UnitsAuditRow[];
  status: string;
  unitsVal: number | null;
  spread: UnitsSpread;
}): UnitsAudit {
  if (input.rows.length === 0) return null;
  const prevUnits = round1(
    input.rows.reduce((sum, r) => sum + consumedUnits(r.status as AttendanceMark, r.units), 0),
  );
  /**
   * 저장 뒤 칸 숫자.
   * · 결석·공결 = 0(시수를 안 쓴다).
   * · `split` = 친 숫자 그대로(배분이 합을 정확히 그 값으로 맞춘다, `splitUnitsAcrossSlots`).
   * · `each` = 행마다 같은 값이라 **행 수를 곱한다**.
   * · 빈 기본값(`unitsVal === null`)만 행 수를 따른다. 명시한 1은 호출부가 숫자 1로 넘긴다.
   */
  const nextUnits = COUNTABLE_STATUSES.has(input.status)
    ? round1(
        input.unitsVal === null
          ? input.rows.length
          : input.spread === "each"
            ? input.unitsVal * input.rows.length
            : input.unitsVal,
      )
    : 0;
  return prevUnits === nextUnits ? null : { prevUnits, nextUnits };
}
