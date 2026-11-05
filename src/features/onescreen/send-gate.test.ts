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
    // 까닭(반 설정)과 할 일(반 설정 변경 요청)까지 한 문장(원장 2026-11-04 *"원인을 선생님이 알 수 없으니까 곤란해하심"*).
    expect(g.hint).toContain("'수업보고서 미발송' 반으로 지정");
    expect(g.hint).toContain("출결만 기록");
    expect(g.hint).toContain("반 설정 변경을 요청하세요");
    expect(g.hint).not.toMatch(/슈퍼|super_admin|총괄/);
  });

  it("🔴 이미 발송된 건이 있으면 그 사실이 먼저다 — 미발송 반이어도 '발송됨'을 가리지 않는다", () => {
    const g = gate({ reportOptout: true, alreadySent: true });
    expect(g.reasons).toEqual(["sent"]);
  });

  // 원장 2026-09-29 — 누르면 워커 결과가 나올 때까지 다시 못 누른다(9/29 박세욱 재클릭 중복 게시).
  it("🔴 발송 대기·게시 중이면 '발송 중'으로 잠근다 — 다른 입력 부족 사유를 덧붙이지 않는다", () => {
    const g = gate({ sendInFlight: true, hasDraft: false });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["in_flight"]);
    expect(g.label).toBe("발송 중 — 잠시 기다려 주세요");
    expect(gate({ sendInFlight: true, lang: "en" }).label).toBe("Sending — please wait");
    // 대기가 끝나면(실패 등) 다시 풀린다 — 이 게이트는 상태 하나만 본다.
    expect(gate({ sendInFlight: false }).canSend).toBe(true);
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

// 원장 2026-10-27 *"보강체크를 하지 않으면 보고서 발송 비활성화 되고 왜 발송안되었는지도"*.
describe("evaluateSendGate — 보강 진행 여부 확인", () => {
  it("확인 전이면 발송 막힘 · 라벨 맨 앞 '보강 진행 여부' · 힌트가 할 일(표식 누르기)을 말한다", () => {
    const g = gate({ needsMakeupCheck: true, hasProgress: false });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["mkcheck", "progress"]);
    expect(g.label).toBe("보강 진행 여부 · 진도 입력 필요");
    expect(g.hint).toContain("보강 표식을 눌러");
  });
  it("확인했으면(또는 보강이 없으면) 종전 판정 그대로", () => {
    expect(gate({ needsMakeupCheck: false }).canSend).toBe(true);
  });
  it("결석·발송 완료는 단독 사유 — 보강 확인을 덧붙이지 않는다", () => {
    expect(gate({ needsMakeupCheck: true, isAbsent: true }).reasons).toEqual(["absent"]);
    expect(gate({ needsMakeupCheck: true, alreadySent: true }).reasons).toEqual(["sent"]);
  });
});
