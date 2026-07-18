import { describe, it, expect } from "vitest";
import {
  parseHM,
  resolveSendWindow,
  kstMinutesOfDay,
  isWithinSendWindow,
  formatSendWindow,
} from "./send-window.mjs";

describe("parseHM", () => {
  it("정상 HH:MM", () => {
    expect(parseHM("00:00")).toBe(0);
    expect(parseHM("09:00")).toBe(540);
    expect(parseHM("23:59")).toBe(1439);
    expect(parseHM(" 21:30 ")).toBe(1290); // 공백 허용
  });
  it("형식 오류·빈 값 = null", () => {
    expect(parseHM("")).toBeNull();
    expect(parseHM("9:00")).toBeNull(); // 한 자리 시
    expect(parseHM("24:00")).toBeNull();
    expect(parseHM("12:60")).toBeNull();
    expect(parseHM("aa:bb")).toBeNull();
    expect(parseHM(null)).toBeNull();
    expect(parseHM(undefined)).toBeNull();
  });
});

describe("resolveSendWindow — fail-open이 원칙", () => {
  it("둘 다 유효 = 창", () => {
    expect(resolveSendWindow("09:00", "21:00")).toEqual({ startMin: 540, endMin: 1260 });
  });
  it("한쪽만 채움·둘 다 빈 값·형식 오류 = 무제한(null)", () => {
    expect(resolveSendWindow("", "")).toBeNull();
    expect(resolveSendWindow("09:00", "")).toBeNull();
    expect(resolveSendWindow("", "21:00")).toBeNull();
    expect(resolveSendWindow("9시", "21:00")).toBeNull();
  });
  it("시작=종료(길이 0) = 무제한 — 발송이 영영 멈추는 사고 방지", () => {
    expect(resolveSendWindow("09:00", "09:00")).toBeNull();
  });
  it("시작>종료 = 자정 넘김 창(유효)", () => {
    expect(resolveSendWindow("21:00", "08:00")).toEqual({ startMin: 1260, endMin: 480 });
  });
});

describe("isWithinSendWindow — 일반 창", () => {
  const w = resolveSendWindow("09:00", "21:00");
  it("창 안", () => {
    expect(isWithinSendWindow(w, 540)).toBe(true); // 09:00 정각 포함
    expect(isWithinSendWindow(w, 720)).toBe(true); // 12:00
    expect(isWithinSendWindow(w, 1259)).toBe(true); // 20:59
  });
  it("창 밖 — 종료 정각은 제외", () => {
    expect(isWithinSendWindow(w, 1260)).toBe(false); // 21:00
    expect(isWithinSendWindow(w, 539)).toBe(false); // 08:59
    expect(isWithinSendWindow(w, 0)).toBe(false); // 자정
    expect(isWithinSendWindow(w, 1380)).toBe(false); // 23:00 — 밤 10시 수업 시나리오
  });
  it("무제한(null)은 항상 true", () => {
    expect(isWithinSendWindow(null, 0)).toBe(true);
    expect(isWithinSendWindow(null, 1380)).toBe(true);
  });
});

describe("isWithinSendWindow — 자정 넘김 창(21:00~08:00)", () => {
  const w = resolveSendWindow("21:00", "08:00");
  it("밤·새벽은 안", () => {
    expect(isWithinSendWindow(w, 1260)).toBe(true); // 21:00
    expect(isWithinSendWindow(w, 1439)).toBe(true); // 23:59
    expect(isWithinSendWindow(w, 0)).toBe(true); // 00:00
    expect(isWithinSendWindow(w, 479)).toBe(true); // 07:59
  });
  it("낮은 밖", () => {
    expect(isWithinSendWindow(w, 480)).toBe(false); // 08:00 종료 정각 제외
    expect(isWithinSendWindow(w, 720)).toBe(false); // 12:00
    expect(isWithinSendWindow(w, 1259)).toBe(false); // 20:59
  });
});

describe("kstMinutesOfDay — Intl(Asia/Seoul), 워커 PC TZ 무관", () => {
  it("UTC 15:00 = KST 다음날 00:00", () => {
    expect(kstMinutesOfDay(new Date("2026-07-18T15:00:00Z"))).toBe(0);
  });
  it("UTC 13:00 = KST 22:00 — 밤 10시 수업 시나리오", () => {
    expect(kstMinutesOfDay(new Date("2026-07-18T13:00:00Z"))).toBe(1320);
  });
  it("UTC 00:30 = KST 09:30", () => {
    expect(kstMinutesOfDay(new Date("2026-07-18T00:30:00Z"))).toBe(570);
  });
});

describe("formatSendWindow", () => {
  it("창 라벨", () => {
    expect(formatSendWindow(resolveSendWindow("09:00", "21:00"))).toBe("09:00~21:00");
    expect(formatSendWindow(null)).toBe("");
  });
});

describe("통합 시나리오 — 밤 10시 발송이 다음날 아침으로 미뤄진다", () => {
  const w = resolveSendWindow("09:00", "21:00");
  it("밤 10시(KST): 창 밖 → 워커 skip", () => {
    const night = kstMinutesOfDay(new Date("2026-07-18T13:00:00Z")); // KST 22:00
    expect(isWithinSendWindow(w, night)).toBe(false);
  });
  it("다음날 아침 9시(KST): 창 진입 → 발송 재개", () => {
    const morning = kstMinutesOfDay(new Date("2026-07-19T00:00:00Z")); // KST 09:00
    expect(isWithinSendWindow(w, morning)).toBe(true);
  });
});
