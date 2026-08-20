/**
 * 사유 프리셋 ↔ **결석 사유 분류기** 정합.
 *
 * 🔴 이게 깨지면 증상이 고약하다: 강사가 칩으로 사유를 **골랐는데** 데스크 화면은 그 줄을
 *    "연락 안 됨 · 긴급"이라고 말한다(`isUrgentAbsence`는 `unknown`만 긴급으로 본다).
 *    칩을 더하거나 문구를 다듬을 땐 [`absence-reason.ts`](../absence-reason.ts) 사전에 그 말이
 *    있는지 **먼저** 볼 것 — 테스트를 고쳐서 통과시키지 말 것.
 */
import { describe, expect, it } from "vitest";
import { classifyAbsenceReason, isUrgentAbsence } from "../absence-reason";
import { ABSENCE_REASON_PRESETS, LATE_REASON_PRESETS } from "./reason-presets";

describe("결석 사유 칩", () => {
  it("아홉 개 전부 planned·sick·school 중 하나로 분류된다(unknown 0)", () => {
    const unknown = ABSENCE_REASON_PRESETS.filter((r) => classifyAbsenceReason(r) === "unknown");
    expect(unknown).toEqual([]);
  });

  it("칩으로 고른 결석은 긴급 줄에 오르지 않는다", () => {
    for (const r of ABSENCE_REASON_PRESETS) {
      expect(isUrgentAbsence(classifyAbsenceReason(r), false), r).toBe(false);
    }
  });

  it("사유를 안 고른 결석은 **긴급 그대로** — 2터치 결석이 긴급을 지우지 않는다", () => {
    expect(isUrgentAbsence(classifyAbsenceReason(null), false)).toBe(true);
  });

  it("빈 목록·중복이 없다", () => {
    expect(ABSENCE_REASON_PRESETS.length).toBeGreaterThan(0);
    expect(new Set(ABSENCE_REASON_PRESETS).size).toBe(ABSENCE_REASON_PRESETS.length);
    expect(new Set(LATE_REASON_PRESETS).size).toBe(LATE_REASON_PRESETS.length);
  });
});

describe("지각 사유 칩", () => {
  it("분류기 대상이 아니다 — 결석 사전에 걸려도 지각 판정에는 쓰이지 않는다", () => {
    // 이 테스트는 "지각 칩이 결석으로 분류되면 안 된다"가 아니라, **분류기가 지각 행을 보지 않는다**는
    // 사실을 문서로 남기는 것이다(`recap/digest.ts`가 absent·excused에만 건다).
    expect(LATE_REASON_PRESETS.length).toBeGreaterThan(0);
  });
});
