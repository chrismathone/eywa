import { describe, expect, it } from "vitest";
import {
  DEFAULT_OBSERVER_LIMIT,
  MAX_OBSERVER_LIMIT,
  MIN_OBSERVER_LIMIT,
  OBSERVER_LIMIT_OPTIONS,
  normalizeObserverLimit,
  observerSlotLabel,
} from "./observer-count";

describe("normalizeObserverLimit — 평가자 정원 정규화", () => {
  it("구버전 문서(값 없음)는 3으로 읽는다 — 그때 실제로 돌던 정원", () => {
    // 🔴 이게 깨지면 이미 만들어진 평가의 선착순 마감 인원이 조용히 바뀐다.
    expect(DEFAULT_OBSERVER_LIMIT).toBe(3);
    expect(normalizeObserverLimit(undefined)).toBe(3);
    expect(normalizeObserverLimit(null)).toBe(3);
    expect(normalizeObserverLimit("")).toBe(3);
  });

  it("폼에서 오는 문자열도 숫자로 받는다(FormData는 항상 문자열)", () => {
    expect(normalizeObserverLimit("5")).toBe(5);
    expect(normalizeObserverLimit(" 2 ")).toBe(2);
    expect(normalizeObserverLimit(4)).toBe(4);
  });

  it("범위를 벗어나면 경계로 접는다 — 0명짜리 평가나 표가 깨지는 20명을 만들 수 없다", () => {
    expect(normalizeObserverLimit(0)).toBe(MIN_OBSERVER_LIMIT);
    expect(normalizeObserverLimit(-3)).toBe(MIN_OBSERVER_LIMIT);
    expect(normalizeObserverLimit(99)).toBe(MAX_OBSERVER_LIMIT);
  });

  it("숫자가 아니거나 소수면 안전하게 떨어진다", () => {
    expect(normalizeObserverLimit("셋")).toBe(DEFAULT_OBSERVER_LIMIT);
    expect(normalizeObserverLimit(NaN)).toBe(DEFAULT_OBSERVER_LIMIT);
    expect(normalizeObserverLimit(3.7)).toBe(3); // 내림 — 3.7칸을 그릴 수는 없다
  });

  it("선택지는 전부 정규화를 통과한다(폼이 고를 수 있는 값 = 서버가 받는 값)", () => {
    expect(OBSERVER_LIMIT_OPTIONS).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of OBSERVER_LIMIT_OPTIONS) expect(normalizeObserverLimit(String(n))).toBe(n);
  });
});

describe("observerSlotLabel — 슬롯 표기", () => {
  it("상세 화면 익명화 표기('평가자 A/B/C')와 폼 placeholder가 같은 규칙", () => {
    expect(observerSlotLabel(0)).toBe("평가자 A");
    expect(observerSlotLabel(2)).toBe("평가자 C");
    expect(observerSlotLabel(MAX_OBSERVER_LIMIT - 1)).toBe("평가자 F");
  });
});
