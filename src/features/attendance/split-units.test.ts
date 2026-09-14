import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitUnitsAcrossSlots, toStoredUnits } from "./session-units";

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10;

describe("splitUnitsAcrossSlots — 그날 합계를 교시별로", () => {
  it("🔴 합이 정확히 친 숫자다(원장 2026-09-01 '입력된 숫자가 입력되도록')", () => {
    for (const [total, slots] of [
      [5, 2],
      [4, 3],
      [2, 3],
      [1.5, 2],
      [12, 4],
      [0.6, 3],
    ] as const) {
      const parts = splitUnitsAcrossSlots(total, slots);
      expect(parts, `${total}/${slots}`).not.toBeNull();
      expect(parts!.length).toBe(slots);
      expect(sum(parts!), `${total}/${slots}`).toBe(total);
    }
  });

  it("🔴 원장에게 보여 준 예시 그대로", () => {
    expect(splitUnitsAcrossSlots(5, 2)).toEqual([2.5, 2.5]);
    expect(splitUnitsAcrossSlots(4, 3)).toEqual([1.4, 1.3, 1.3]);
  });

  it("교시가 하나면 그대로", () => {
    expect(splitUnitsAcrossSlots(5, 1)).toEqual([5]);
    expect(splitUnitsAcrossSlots(1.5, 1)).toEqual([1.5]);
  });

  it("🔴 교시당 0.1도 안 되면 null — 값을 지어내지 않는다", () => {
    expect(splitUnitsAcrossSlots(0.2, 3)).toBeNull();
    expect(splitUnitsAcrossSlots(0.1, 2)).toBeNull();
    expect(splitUnitsAcrossSlots(0, 2)).toBeNull();
    expect(splitUnitsAcrossSlots(-1, 2)).toBeNull();
  });

  it("소수 한 자리를 넘지 않는다(저장 규약)", () => {
    for (const parts of [splitUnitsAcrossSlots(4, 3)!, splitUnitsAcrossSlots(5, 3)!, splitUnitsAcrossSlots(2, 3)!]) {
      for (const p of parts) expect(Math.round(p * 10) / 10).toBe(p);
    }
  });

  it("1은 저장할 때 null(기본 배수) — parseSessionUnits와 같은 규약", () => {
    expect(toStoredUnits(1)).toBeNull();
    expect(toStoredUnits(1.5)).toBe(1.5);
    expect(toStoredUnits(2)).toBe(2);
  });
});

describe("배선 — 부풀림이 다시 생기지 않게", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

  it("🔴 서버는 '그날 칸(교시 미지정)'일 때만 나눈다 — 교시 지정 저장(ECS)은 안 건드린다", () => {
    // 배분 규칙은 scoped-split.ts `planDayCellUnits` 한 벌(2026-09-11 — 강사 보기에선 그 강사 몫 행에만 나누도록 옮김).
    const src = read("features/attendance/server/actions.ts");
    const rule = read("features/attendance/scoped-split.ts");
    expect(rule).toContain("splitUnitsAcrossSlots(input.unitsVal, receivers.length)");
    // 빗금 칸 입력(원장 2026-09-14)은 그날 칸이어도 나누지 않는다(상태만) — 그래서 조건에 `&& !transfer`가 붙을 수 있다.
    expect(src).toMatch(/if \(slot === null(?: && !transfer)?\) \{[\s\S]{0,800}planDayCellUnits\(/);
    // 액션이 직접 나누면 강사 보기의 몫 규칙을 건너뛴다 — 나누는 곳은 한 곳뿐이어야 한다.
    expect(src).not.toContain("splitUnitsAcrossSlots(");
  });

  it("🔴 화면은 명시 숫자를 곱하지 않는다(서버와 같은 규칙)", () => {
    // 낙관값 규칙은 grid/optimistic-value.ts 한 벌(2026-09-11 grid-context에서 옮김 — 수학 자동 시수) — 격자는 그 함수를 부른다.
    const grid = read("app/(shell)/attendance/_components/grid-context.tsx");
    const rule = read("features/attendance/grid/optimistic-value.ts");
    expect(grid).toContain("optimisticGridValue(");
    for (const src of [grid, rule]) {
      expect(src).not.toContain("Math.round((raw ?? 1) * n * 10) / 10");
      expect(src).not.toMatch(/\(raw \?\? 1\) \* slotCount/);
    }
    expect(rule).toContain("if (raw !== null) return { s: v.status, u: raw };");
  });
});
