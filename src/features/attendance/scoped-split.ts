/**
 * 출석부 **그날 칸(교시 미지정)** 에 친 시수를 어느 행에 얼마씩 담나 — 셀 저장(`setAttendanceCell`)과
 * 범위 저장(`setAttendanceRange`)이 이 **한 함수**를 지난다(순수, Vitest).
 *
 * 🔴 원장 제보 2026-09-11: *"출석부에서 선생님이 숫자를 입력하고 닫는데, 새로고침하면 강제로 어떤 숫자로 롤백"*.
 *    강사 전체 보기의 칸은 **그 강사 몫 교시의 합**만 보여 준다(`ownsAttendanceSlot`). 그런데 저장은 그 합을
 *    **그날 모든 교시**(자리 JJ·다른 선생님 교시 포함)에 나눠 담아서, 다시 읽으면 제 몫만 남아 숫자가 줄었다
 *    (실측: 중등E_중2 정규 A 9/10 = 16:20 JJ · 17:20 Charlie · 18:20 Charlie — 4를 치면 1.3·1.3·1.4로 저장돼
 *    Charlie 화면엔 2.7). → 스코프가 있으면 **그 강사 몫 행에만** 나누고, 나머지 행의 시수는 그대로 둔다.
 * ⚠️ 상태는 여기서 다루지 않는다 — 그날 칸의 상태는 종전대로 그날 모든 교시에 간다(칸이 "함께 바뀝니다"로 알린다).
 * ⚠️ 반별 보기(`owns === null`)는 종전과 **같은 답**이다(전 행이 받는다).
 */
import { splitUnitsAcrossSlots, toStoredUnits } from "./session-units";

/** 저장 대상 한 행 — `pickSaveTargets(rows, null)`이 고른 그날 교시별 최신 행. */
export type DayTargetRow = {
  id: string;
  /** null = "그날 전체"(교시를 안 남긴 기록). */
  slot_start?: string | null;
  /** 자리 시수 행 표식(0208a) — 있으면 어느 강사 몫도 아니다(`ownsAttendanceSlot`). */
  seat_label?: string | null;
};

export type DayUnitsPlan =
  | {
      ok: true;
      /** id → 저장할 `session_units`(null = 기본 1). **맵에 없는 id는 시수를 건드리지 않는다**(상태만 받는다). */
      units: ReadonlyMap<string, number | null>;
    }
  /** 스코프가 있는데 그 강사 몫 행이 하나도 없다 — 강사 보기에선 빗금 칸이라 저장하지 않는다. */
  | { ok: false; reason: "noneOwned" }
  /** 받을 행 수로 나누면 교시당 0.1이 안 된다 — 값을 지어내지 않는다. */
  | { ok: false; reason: "indivisible"; slots: number };

/**
 * @param targets `pickSaveTargets(rows, null).updateIds` **순서 그대로**의 행 — 나머지는 첫 행이 갖는다
 *                (`splitUnitsAcrossSlots` 규약).
 * @param owns 이 행이 스코프 강사 몫인가. null = 반별 보기(전부 그 반 몫).
 * @param unitsVal undefined = 시수를 안 보낸 저장(상태만) · null = 교시마다 기본(1) · 숫자 = 그날 합계.
 */
export function planDayCellUnits<T extends DayTargetRow>(input: {
  targets: readonly T[];
  owns: ((row: T) => boolean) | null;
  unitsVal: number | null | undefined;
}): DayUnitsPlan {
  const receivers = input.owns ? input.targets.filter(input.owns) : input.targets;
  if (input.owns && input.targets.length > 0 && receivers.length === 0) return { ok: false, reason: "noneOwned" };
  const units = new Map<string, number | null>();
  if (input.unitsVal === undefined) return { ok: true, units };
  // 빈칸·"1"(=교시마다 기본)과 받는 행이 하나뿐인 경우는 나눌 게 없다 — 친 값 그대로.
  if (input.unitsVal === null || receivers.length <= 1) {
    for (const r of receivers) units.set(r.id, input.unitsVal);
    return { ok: true, units };
  }
  const parts = splitUnitsAcrossSlots(input.unitsVal, receivers.length);
  if (!parts) return { ok: false, reason: "indivisible", slots: receivers.length };
  receivers.forEach((r, i) => units.set(r.id, toStoredUnits(parts[i]!)));
  return { ok: true, units };
}

/**
 * 같은 시수끼리 묶는다(한 문장으로 쓰려고) — `units === undefined` = 시수 불변(상태만). 순서는 처음 나온 순.
 */
export function groupByPlannedUnits(
  ids: readonly string[],
  units: ReadonlyMap<string, number | null>,
): { units: number | null | undefined; ids: string[] }[] {
  const out = new Map<string, { units: number | null | undefined; ids: string[] }>();
  for (const id of ids) {
    const u = units.has(id) ? (units.get(id) as number | null) : undefined;
    const k = u === undefined ? "keep" : String(u);
    (out.get(k) ?? out.set(k, { units: u, ids: [] }).get(k)!).ids.push(id);
  }
  return [...out.values()];
}

/** 스코프 강사가 그 달에 이 반을 안 맡는다 — 화면이 오래돼 반 배치가 바뀐 경우가 거의 전부다. */
export const SCOPE_NOT_TAUGHT_MESSAGE =
  "이 반은 지금 이 선생님 출석부에 없는 반이라 저장하지 않았습니다 — 새로고침한 뒤 다시 입력해 주세요";
/** 판정 재료(반 담임·교시)를 못 읽었다 — 스코프 없이 나누면 이 버그가 그대로 나므로 저장하지 않는다. */
export const SCOPE_LOAD_FAILED_MESSAGE =
  "선생님 몫 교시를 확인하지 못해 저장하지 않았습니다 — 잠시 후 다시 시도해 주세요";
/** 스코프 id 형식이 아니다(화면이 만든 값이 아니다). */
export const SCOPE_INVALID_MESSAGE = "잘못된 선생님 보기입니다 — 새로고침한 뒤 다시 시도해 주세요";
