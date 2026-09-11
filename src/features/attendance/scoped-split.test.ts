/**
 * 그날 칸 시수 배분 — 강사 전체 보기는 **그 강사 몫 행에만**(원장 제보 2026-09-11), 반별 보기는 종전 그대로.
 * 몫 판정 자체(누구 교시인가)는 `scope-ownership.test.ts`가 잠근다 — 여기는 "받는 행이 정해진 뒤 얼마씩"이다.
 */
import { describe, expect, it } from "vitest";
import { groupByPlannedUnits, planDayCellUnits, type DayTargetRow, type DayUnitsPlan } from "./scoped-split";
import { splitUnitsAcrossSlots, toStoredUnits } from "./session-units";

/** 실례: 중등E_중2 정규 A 2026-09-10(목) — 저장 액션의 조회 순서(최근 입력 먼저) 그대로. */
const R1820: DayTargetRow = { id: "r-1820", slot_start: "18:20:00", seat_label: null };
const R1720: DayTargetRow = { id: "r-1720", slot_start: "17:20:00", seat_label: null };
const RJJ: DayTargetRow = { id: "r-jj", slot_start: "16:20:00", seat_label: null };
const DAY = [R1820, R1720, RJJ];
/** Charlie 몫 = 17:20·18:20(자리 JJ는 아무의 몫도 아니다). */
const charlie = (r: DayTargetRow) => r.id !== RJJ.id;

const unitsOf = (plan: DayUnitsPlan) => (plan.ok ? Object.fromEntries(plan.units) : plan);

/** 종전 규칙(2026-09-01~09-11 actions.ts의 분배) 그대로 — 반별 보기는 이것과 같은 답이어야 한다. */
function legacy(ids: string[], unitsVal: number | null | undefined): unknown {
  if (unitsVal === undefined) return {};
  if (unitsVal === null || ids.length <= 1) return Object.fromEntries(ids.map((id) => [id, unitsVal]));
  const parts = splitUnitsAcrossSlots(unitsVal, ids.length);
  if (!parts) return { ok: false, reason: "indivisible", slots: ids.length };
  return Object.fromEntries(ids.map((id, i) => [id, toStoredUnits(parts[i]!)]));
}

describe("planDayCellUnits — 강사 전체 보기(그 강사 몫 행에만)", () => {
  it("🔴 4를 치면 Charlie 두 교시가 2·2 — 자리 JJ 행은 시수를 안 받는다(원장 제보 2026-09-11)", () => {
    const plan = planDayCellUnits({ targets: DAY, owns: charlie, unitsVal: 4 });
    expect(unitsOf(plan)).toEqual({ "r-1820": 2, "r-1720": 2 });
  });

  it("🔴 나눈 합 = 친 숫자 = 새로고침 뒤 그 강사 칸 숫자(종전엔 1.3+1.4 = 2.7)", () => {
    for (const total of [4, 5, 3, 2, 1.5, 7.5]) {
      const plan = planDayCellUnits({ targets: DAY, owns: charlie, unitsVal: total });
      expect(plan.ok, String(total)).toBe(true);
      if (!plan.ok) continue;
      const sum = [...plan.units.values()].reduce<number>((a, u) => a + (u ?? 1), 0);
      expect(Math.round(sum * 10) / 10, String(total)).toBe(total);
      expect(plan.units.has(RJJ.id), String(total)).toBe(false);
    }
  });

  it('빈칸·"1"(null)은 제 몫 교시마다 기본 — 남의 행은 안 건드린다', () => {
    expect(unitsOf(planDayCellUnits({ targets: DAY, owns: charlie, unitsVal: null }))).toEqual({
      "r-1820": null,
      "r-1720": null,
    });
  });

  it("제 몫이 한 행뿐이면 친 값 그대로(나눌 게 없다)", () => {
    const only1720 = (r: DayTargetRow) => r.id === R1720.id;
    expect(unitsOf(planDayCellUnits({ targets: DAY, owns: only1720, unitsVal: 4 }))).toEqual({ "r-1720": 4 });
    expect(unitsOf(planDayCellUnits({ targets: DAY, owns: only1720, unitsVal: 1.5 }))).toEqual({ "r-1720": 1.5 });
  });

  it("시수를 안 보낸 저장(상태만)은 시수 계획이 비어 있다 — 어느 행도 시수를 안 바꾼다", () => {
    expect(planDayCellUnits({ targets: DAY, owns: charlie, unitsVal: undefined })).toEqual({ ok: true, units: new Map() });
  });

  it("🔴 제 몫 행이 하나도 없으면 noneOwned — 강사 보기의 빗금 칸이라 저장하지 않는다", () => {
    for (const unitsVal of [4, null, undefined]) {
      expect(planDayCellUnits({ targets: [RJJ], owns: charlie, unitsVal })).toEqual({ ok: false, reason: "noneOwned" });
    }
  });

  it("새 칸(대상 행 없음)은 noneOwned가 아니다 — 새 행을 만드는 경로라 몫을 가를 행이 없다", () => {
    expect(planDayCellUnits({ targets: [], owns: charlie, unitsVal: 4 })).toEqual({ ok: true, units: new Map() });
  });

  it("교시당 0.1이 안 되면 indivisible — 교시 수는 **받는 행** 수로 센다", () => {
    expect(planDayCellUnits({ targets: DAY, owns: charlie, unitsVal: 0.1 })).toEqual({
      ok: false,
      reason: "indivisible",
      slots: 2,
    });
  });
});

describe("planDayCellUnits — 반별 보기(owns=null)는 종전과 같다", () => {
  it("🔴 전 행이 받는다 — 4 → 1.4·1.3·1.3(첫 행이 나머지 · 제보된 저장값 그대로)", () => {
    expect(unitsOf(planDayCellUnits({ targets: DAY, owns: null, unitsVal: 4 }))).toEqual({
      "r-1820": 1.4,
      "r-1720": 1.3,
      "r-jj": 1.3,
    });
  });

  it("값·교시 수를 바꿔도 종전 규칙과 같은 답", () => {
    const rows = (n: number): DayTargetRow[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, slot_start: null }));
    for (const n of [1, 2, 3, 4]) {
      for (const unitsVal of [undefined, null, 0.1, 0.2, 1.5, 2, 4, 5, 12, 20]) {
        const targets = rows(n);
        expect(unitsOf(planDayCellUnits({ targets, owns: null, unitsVal })), `${n}교시 · ${String(unitsVal)}`).toEqual(
          legacy(
            targets.map((t) => t.id),
            unitsVal,
          ),
        );
      }
    }
  });
});

describe("groupByPlannedUnits — 같은 시수끼리 한 문장", () => {
  it("계획에 없는 행은 '그대로'(keep) 묶음 · null(=1)과 keep은 다른 묶음", () => {
    const units = new Map<string, number | null>([
      ["a", 2],
      ["b", 2],
      ["c", null],
    ]);
    expect(groupByPlannedUnits(["a", "b", "c", "d"], units)).toEqual([
      { units: 2, ids: ["a", "b"] },
      { units: null, ids: ["c"] },
      { units: undefined, ids: ["d"] },
    ]);
  });

  it("계획이 비면 전부 한 묶음(시수 불변)", () => {
    expect(groupByPlannedUnits(["a", "b"], new Map())).toEqual([{ units: undefined, ids: ["a", "b"] }]);
  });
});
