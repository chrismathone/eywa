import { describe, expect, it } from "vitest";
import {
  ELAPSED_STRONG_DAYS,
  ELAPSED_WARN_DAYS,
  elapsedDays,
  shouldShowElapsed,
  textbookOrderSettled,
} from "./textbook-progress";

const checks = (registered: boolean, paid: boolean, ordered: boolean) => ({ registered, paid, ordered });

describe("textbookOrderSettled — 등록·납부·주문 셋 다여야 완료", () => {
  it("셋 다 체크면 완료", () => {
    expect(textbookOrderSettled(checks(true, true, true))).toBe(true);
  });

  // 🔴 부분 완료를 완료로 넓히면 아직 손 볼 줄에서 지연 신호가 사라진다(브리프의 5행·2행).
  it("두 개까지만 체크면 완료가 아니다", () => {
    expect(textbookOrderSettled(checks(true, true, false))).toBe(false); // 등록+납부, 주문 남음
    expect(textbookOrderSettled(checks(true, false, true))).toBe(false);
    expect(textbookOrderSettled(checks(false, true, true))).toBe(false); // "주문만 됐으면 끝"이 아니다
  });

  it("하나만·아무것도 아니면 완료가 아니다", () => {
    expect(textbookOrderSettled(checks(true, false, false))).toBe(false);
    expect(textbookOrderSettled(checks(false, false, false))).toBe(false);
  });
});

describe("elapsedDays — 신청일 경과일수(TZ 무관 정수)", () => {
  it("같은 날은 0일", () => {
    expect(elapsedDays("2026-08-20", "2026-08-20")).toBe(0);
  });

  it("달을 넘겨도 정수 일수로 센다", () => {
    expect(elapsedDays("2026-07-28", "2026-08-20")).toBe(23);
  });

  it("신청일이 없거나 형식이 깨졌으면 null", () => {
    expect(elapsedDays(null, "2026-08-20")).toBeNull();
    expect(elapsedDays("", "2026-08-20")).toBeNull();
    expect(elapsedDays("2026-08-20", "")).toBeNull();
  });
});

describe("shouldShowElapsed — 경과 라벨은 '아직 안 끝난 줄'에만", () => {
  // 🔴 이 케이스가 2026-08-20 제보의 본체 — 실측 485건 중 484건이 이렇게 거짓 라벨을 달고 있었다.
  it("셋 다 끝난 줄에는 아무리 오래돼도 안 붙는다", () => {
    expect(shouldShowElapsed(checks(true, true, true), 9)).toBe(false);
    expect(shouldShowElapsed(checks(true, true, true), 13)).toBe(false);
    expect(shouldShowElapsed(checks(true, true, true), 400)).toBe(false);
  });

  it("부분 완료는 그대로 유지한다 — 아직 손 볼 줄이다", () => {
    expect(shouldShowElapsed(checks(true, true, false), 9)).toBe(true); // 주문 남음
    expect(shouldShowElapsed(checks(true, false, false), 9)).toBe(true); // 등록만
    expect(shouldShowElapsed(checks(false, false, false), 9)).toBe(true); // 손도 안 댐
    expect(shouldShowElapsed(checks(false, true, true), 9)).toBe(true); // 주문됐어도 등록 남음
  });

  // ⚠️ 임계값은 이번 변경 대상이 아니다 — "끝난 줄"이 문제였지 기준일이 아니었다.
  it("임계값(7일) 경계를 그대로 지킨다", () => {
    expect(ELAPSED_WARN_DAYS).toBe(7);
    expect(ELAPSED_STRONG_DAYS).toBe(14);
    expect(shouldShowElapsed(checks(false, false, false), ELAPSED_WARN_DAYS - 1)).toBe(false);
    expect(shouldShowElapsed(checks(false, false, false), ELAPSED_WARN_DAYS)).toBe(true);
  });

  it("신청일이 없으면(경과 null) 붙이지 않는다", () => {
    expect(shouldShowElapsed(checks(false, false, false), null)).toBe(false);
  });
});
