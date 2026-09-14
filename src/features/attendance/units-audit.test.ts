import { describe, expect, it } from "vitest";
import { unitsAuditFields } from "./units-audit";

/**
 * 감사로그 "시수 3 → 1.5" — 적대 리뷰 2026-09-14가 잡은 거짓말들을 잠근다.
 * 초안은 행 값을 그대로 더해서 ① 결석을 1로 세고 ② 부동소수 꼬리를 흘리고 ③ 같은 수업을 두 번 셌고,
 * 1차 수리는 ③을 고치려다 교시 지정 저장에서 **대표 1행만 세어 격자의 절반**을 적었다(재리뷰).
 */
describe("unitsAuditFields — 출결 감사로그의 전·후 시수", () => {
  it("결석 행은 0으로 센다 — 화면 칸 숫자와 같은 값이어야 한다", () => {
    /**
     * 영어 2교시 칸: 16:20 결석 + 17:20 출석 → 화면은 **1**(결석은 0). 여기에 출석을 저장하면 두 교시가
     * 모두 출석이 되어 칸은 **2**가 된다. 🔴 행 값을 그대로 더하던 초안은 이 칸을 `2 → 1`이라고 적었다
     * — 있지도 않던 값에서 줄어든 것처럼.
     */
    expect(
      unitsAuditFields({
        rows: [
          { status: "absent", units: null },
          { status: "present", units: null },
        ],
        status: "present",
        unitsVal: null,
        spread: "split",
      }),
    ).toEqual({ prevUnits: 1, nextUnits: 2 });
  });

  it("정말 안 바뀐 저장은 null — 같은 값 재저장까지 적으면 평시 로그가 길어진다", () => {
    expect(
      unitsAuditFields({
        rows: [
          { status: "present", units: null },
          { status: "present", units: null },
        ],
        status: "present",
        unitsVal: null,
        spread: "split",
      }),
    ).toBeNull();
  });

  it("결석 행을 1로 세면 안 된다 — 0 → 1.5가 나와야 한다", () => {
    expect(
      unitsAuditFields({ rows: [{ status: "excused", units: 3 }], status: "present", unitsVal: 1.5, spread: "split" }),
    ).toEqual({ prevUnits: 0, nextUnits: 1.5 });
  });

  it("부동소수 꼬리를 흘리지 않는다 — 1.1×3은 3.3이다(같은 값이면 null)", () => {
    expect(
      unitsAuditFields({
        rows: [
          { status: "present", units: 1.1 },
          { status: "present", units: 1.1 },
          { status: "present", units: 1.1 },
        ],
        status: "present",
        unitsVal: 3.3,
        spread: "split",
      }),
    ).toBeNull();
  });

  it("원장 사례 — 3 → 1.5(영어 3교시 칸)", () => {
    expect(
      unitsAuditFields({
        rows: [
          { status: "present", units: null },
          { status: "present", units: null },
          { status: "present", units: null },
        ],
        status: "present",
        unitsVal: 1.5,
        spread: "split",
      }),
    ).toEqual({ prevUnits: 3, nextUnits: 1.5 });
  });

  it("원장 사례 — 1.5 → 1(수학 1교시 칸, '1'은 null로 저장된다)", () => {
    expect(
      unitsAuditFields({
        rows: [{ status: "present", units: 1.5 }],
        status: "present",
        unitsVal: null,
        spread: "split",
      }),
    ).toEqual({ prevUnits: 1.5, nextUnits: 1 });
  });

  it("교시마다 기본(1)은 **행 수만큼**이 된다 — 2교시 칸은 2", () => {
    expect(
      unitsAuditFields({
        rows: [
          { status: "present", units: 1.5 },
          { status: "present", units: 1.5 },
        ],
        status: "present",
        unitsVal: null,
        spread: "split",
      }),
    ).toEqual({ prevUnits: 3, nextUnits: 2 });
  });

  it("결석으로 바꾸면 칸은 0이 된다", () => {
    expect(
      unitsAuditFields({ rows: [{ status: "present", units: 3 }], status: "absent", unitsVal: 1.5, spread: "split" }),
    ).toEqual({ prevUnits: 3, nextUnits: 0 });
  });

  it("잴 행이 없으면 null — 새 칸은 이전 값이 없다", () => {
    expect(unitsAuditFields({ rows: [], status: "present", unitsVal: 1.5, spread: "split" })).toBeNull();
  });

  it("보강·지각·조퇴도 시수를 소비한다", () => {
    expect(
      unitsAuditFields({ rows: [{ status: "late", units: 2 }], status: "makeup", unitsVal: null, spread: "split" }),
    ).toEqual({ prevUnits: 2, nextUnits: 1 });
  });

  /**
   * 🔴 교시 지정 저장(ECS)은 대상 행 **전부에 같은 값**을 쓴다 — "그 교시 + 옛 그날 전체 행"이 함께 있으면
   *    월간 격자가 두 행을 합산하므로(`rollupDay`는 slot 키로 가른다) 칸은 **2배**가 된다.
   *    대표 1행만 세면 격자의 절반을 적는다(재리뷰 2026-09-14).
   */
  it("교시 지정 저장(each)은 행 수를 곱한다 — 대표 1행만 세면 격자의 절반이 된다", () => {
    expect(
      unitsAuditFields({
        rows: [
          { status: "present", units: null },
          { status: "present", units: null },
        ],
        status: "present",
        unitsVal: 1.5,
        spread: "each",
      }),
    ).toEqual({ prevUnits: 2, nextUnits: 3 });
  });

  it("each도 행이 하나면 split과 같다 — 대부분의 교시 지정 저장이 이쪽이다", () => {
    expect(
      unitsAuditFields({
        rows: [{ status: "present", units: 1.5 }],
        status: "present",
        unitsVal: null,
        spread: "each",
      }),
    ).toEqual({ prevUnits: 1.5, nextUnits: 1 });
    expect(
      unitsAuditFields({ rows: [{ status: "present", units: 3 }], status: "present", unitsVal: 1.5, spread: "each" }),
    ).toEqual({ prevUnits: 3, nextUnits: 1.5 });
  });
});
