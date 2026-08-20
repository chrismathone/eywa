import { describe, expect, it } from "vitest";
import { evaluateSendGate } from "./send-gate";

const gate = (over: Partial<Parameters<typeof evaluateSendGate>[0]> = {}) =>
  evaluateSendGate({
    alreadySent: false,
    isAbsent: false,
    hasProgress: true,
    hasDraft: true,
    attendanceUnchecked: false,
    ...over,
  });

describe("evaluateSendGate", () => {
  it("진도·멘트가 있고 결석·발송완료가 아니면 발송 가능", () => {
    const g = gate();
    expect(g.canSend).toBe(true);
    expect(g.reasons).toEqual([]);
    expect(g.label).toBeNull();
  });

  // '수업보고서 미발송' 반(0174a, 2026-08-19) — 반은 출결 때문에 화면에 있고 발송만 없다.
  it("미발송 반이면 사유가 단독으로 나온다 — '진도·멘트 입력 필요'를 덧붙이지 않는다", () => {
    const g = gate({ reportOptout: true, hasProgress: false, hasDraft: false });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["report_optout"]);
    expect(g.label).toBe("미발송 반 — 출결만");
    expect(g.hint).toContain("출결만 기록합니다");
  });

  it("🔴 이미 발송된 건이 있으면 그 사실이 먼저다 — 미발송 반이어도 '발송됨'을 가리지 않는다", () => {
    const g = gate({ reportOptout: true, alreadySent: true });
    expect(g.reasons).toEqual(["sent"]);
  });

  it("진도가 없으면 '진도 입력 필요'", () => {
    const g = gate({ hasProgress: false });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["progress"]);
    expect(g.label).toBe("진도 입력 필요");
  });

  it("🔴 멘트가 비면 발송 불가 — 빈 멘트 절대 가드가 어차피 막는다(버튼만 살아 있으면 거짓말)", () => {
    const g = gate({ hasDraft: false });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["ment"]);
    expect(g.label).toBe("멘트 입력 필요");
  });

  // 출결 미체크 발송 게이트(2026-08-17) — 출결 체크도 진도·멘트 같은 필요 입력.
  it("출결 미체크면 '출결 입력 필요' — 다른 필요 입력과 함께 앞에 나열된다", () => {
    const g = gate({ attendanceUnchecked: true });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["attendance"]);
    expect(g.label).toBe("출결 입력 필요");
    const g2 = gate({ attendanceUnchecked: true, hasProgress: false, hasDraft: false });
    expect(g2.reasons).toEqual(["attendance", "progress", "ment"]);
    expect(g2.label).toBe("출결 · 진도 · 멘트 입력 필요");
  });

  it("결석은 미체크가 아니다 — 결석 사유가 단독으로 보고된다(체크하라는 안내는 거짓)", () => {
    const g = gate({ isAbsent: true, attendanceUnchecked: false });
    expect(g.reasons).toEqual(["absent"]);
  });

  it("둘 다 없으면 둘 다 알려준다", () => {
    const g = gate({ hasProgress: false, hasDraft: false });
    expect(g.reasons).toEqual(["progress", "ment"]);
    expect(g.label).toBe("진도 · 멘트 입력 필요");
  });

  it("발송 완료는 단독 사유 — 남은 입력을 같이 띄우지 않는다(수정 자체가 금지)", () => {
    const g = gate({ alreadySent: true, hasProgress: false, hasDraft: false });
    expect(g.reasons).toEqual(["sent"]);
    expect(g.label).toBe("발송됨 — 재발송 불가");
  });

  it("결석도 단독 사유 — 발송 완료가 우선", () => {
    expect(gate({ isAbsent: true }).reasons).toEqual(["absent"]);
    expect(gate({ isAbsent: true, alreadySent: true }).reasons).toEqual(["sent"]);
  });

  it("막힌 경우엔 항상 라벨과 상세가 함께 나온다(이유 없는 비활성 금지)", () => {
    for (const over of [
      { alreadySent: true },
      { isAbsent: true },
      { hasProgress: false },
      { hasDraft: false },
    ]) {
      const g = gate(over);
      expect(g.canSend).toBe(false);
      expect(g.label).toBeTruthy();
      expect(g.hint).toBeTruthy();
    }
  });

  it("'다른 강사 뷰'(열람 전용) — 다른 모든 사유보다 앞서고, 라벨·힌트가 반드시 있다", () => {
    const g = evaluateSendGate({
      alreadySent: false,
      isAbsent: false,
      hasProgress: true,
      hasDraft: true,
      attendanceUnchecked: false,
      readonlyView: true,
    });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["readonly"]);
    expect(g.label).toBe("열람 전용"); // 비활성 버튼엔 항상 보이는 사유(2026-07-30 불변식)
    expect(g.hint).toContain("열람 전용");
  });
});
