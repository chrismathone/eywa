import { describe, expect, it } from "vitest";
import { isRecordless, optimisticGridValue } from "./optimistic-value";
import type { GridValue } from "./store";

const P = (units: string) => ({ status: "present" as const, units });
const A = (units = "") => ({ status: "absent" as const, units });

describe("isRecordless — 출결 행이 아직 없는 칸", () => {
  it("빈 칸 · 수업보고서 파생 칸(d)은 행이 없다", () => {
    expect(isRecordless(null)).toBe(true);
    expect(isRecordless({ s: "present", u: null, d: true })).toBe(true);
  });
  it("기록이 있는 칸(파생 표식 없음)은 행이 있다", () => {
    expect(isRecordless({ s: "present", u: null })).toBe(false);
    expect(isRecordless({ s: "absent", u: null })).toBe(false);
  });
});

describe("optimisticGridValue — 저장 전에 칸에 칠할 값(서버 저장 규칙과 같은 답)", () => {
  it("🔴 빈 칸 + 숫자 안 고름 = 서버가 넣을 수학 자동 시수", () => {
    expect(optimisticGridValue(P(""), null, 1.5, 1)).toEqual({ s: "present", u: 1.5 });
  });

  it("🔴 파생 칸(상태는 보이지만 행이 없다)도 새 행이라 자동 시수 — 1을 칠했다가 1.5로 튀지 않게", () => {
    expect(optimisticGridValue(P(""), { s: "present", u: null, d: true }, 1.5, 1)).toEqual({ s: "present", u: 1.5 });
  });

  it("🔴 기록이 있는 칸은 자동값을 안 받는다(서버 UPDATE는 강사가 고친 값·명시 1을 보존)", () => {
    expect(optimisticGridValue(P(""), { s: "absent", u: null }, 1.5, 1)).toEqual({ s: "present", u: null });
  });

  it("🔴 친 숫자는 쓴 그대로 — \"1\"은 명시(null로 접는다), \"2\"는 2", () => {
    expect(optimisticGridValue(P("1"), null, 1.5, 1)).toEqual({ s: "present", u: null });
    expect(optimisticGridValue(P("2"), null, 1.5, 1)).toEqual({ s: "present", u: 2 });
  });

  it("결석엔 시수가 없다 — 자동값도 교시 곱도 없다", () => {
    expect(optimisticGridValue(A(), null, 1.5, 3)).toEqual({ s: "absent", u: null });
  });

  it("자동값이 없으면 종전 규칙 그대로 — 교시가 여럿인 날 기본은 교시 수, 명시 숫자는 합계", () => {
    expect(optimisticGridValue(P(""), null, null, 1)).toEqual({ s: "present", u: null });
    expect(optimisticGridValue(P(""), { s: "present", u: 3 }, null, 3)).toEqual({ s: "present", u: 3 });
    expect(optimisticGridValue(P("4"), { s: "present", u: 3 }, null, 3)).toEqual({ s: "present", u: 4 });
  });

  it("지우기(null)는 빈 칸", () => {
    expect(optimisticGridValue(null, { s: "present", u: 2 }, 1.5, 1)).toBeNull();
  });
});

describe("🔴 어떤 원문도 NaN을 칠하지 않는다(재리뷰 2026-09-11 — NaN 스냅샷이 무한 렌더로 화면을 떨어뜨렸다)", () => {
  it('"1,5"·"abc"·"  " × 교시 수 × 칸 상태 × 자동 시수 — 시수는 유한한 숫자이거나 null', () => {
    const currents: GridValue[] = [null, { s: "absent", u: null }, { s: "present", u: null, d: true }];
    for (const units of ["1,5", "abc", "  "]) {
      for (const slotCount of [1, 2, 3]) {
        for (const current of currents) {
          for (const auto of [null, 1.5]) {
            const u = optimisticGridValue(P(units), current, auto, slotCount)?.u ?? null;
            expect(u === null || Number.isFinite(u), `${units}·${slotCount}교시·${JSON.stringify(current)}·${auto}`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it('쉼표 소수점은 서버와 같은 값 — "1,5" = 1.5(교시가 여럿이어도 친 합계 그대로)', () => {
    expect(optimisticGridValue(P("1,5"), { s: "absent", u: null }, null, 1)).toEqual({ s: "present", u: 1.5 });
    expect(optimisticGridValue(P("1,5"), { s: "absent", u: null }, null, 2)).toEqual({ s: "present", u: 1.5 });
  });

  it("서버가 거절할 원문(형식 오류)은 시수를 안 칠한다 — 기본과 같은 값(교시가 여럿이면 교시 수)", () => {
    expect(optimisticGridValue(P("abc"), { s: "absent", u: null }, null, 1)).toEqual({ s: "present", u: null });
    expect(optimisticGridValue(P("abc"), { s: "absent", u: null }, null, 2)).toEqual({ s: "present", u: 2 });
    expect(optimisticGridValue(P("  "), { s: "absent", u: null }, null, 2)).toEqual({ s: "present", u: 2 });
  });
});
