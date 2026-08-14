import { describe, expect, it } from "vitest";
import {
  configuredLabPin,
  nextPinAttempt,
  normalizePin,
  pinsMatch,
  recordPinFailure,
  SEAT_PIN_RL_GLOBAL_MAX,
  SEAT_PIN_RL_MAX,
  SEAT_PIN_RL_WINDOW_MS,
  signSeatPin,
  verifySeatPin,
} from "./pin";

const SECRET = "test-secret-not-for-prod";

describe("PIN 정규화·비교", () => {
  it("앞뒤 공백만 지우고 자리 0은 남긴다", () => {
    expect(normalizePin("  07099  ")).toBe("07099");
    expect(normalizePin("7099")).toBe("7099");
  });

  it("같은 PIN만 통과한다", () => {
    expect(pinsMatch("7099", "7099")).toBe(true);
    expect(pinsMatch(" 7099 ", "7099")).toBe(true);
    expect(pinsMatch("7098", "7099")).toBe(false);
    expect(pinsMatch("709", "7099")).toBe(false);
    expect(pinsMatch("", "7099")).toBe(false);
  });

  it("설정 PIN이 비면 공개 접속을 끈다", () => {
    expect(configuredLabPin("7099")).toBe("7099");
    expect(configuredLabPin("  ")).toBeNull();
    expect(configuredLabPin("")).toBeNull();
    expect(configuredLabPin(undefined)).toBeNull();
  });
});

describe("쿠키 서명", () => {
  const payload = { tenantId: "t-1", seat: "lab" as const, exp: Date.now() + 60_000 };

  it("서명하고 같은 비밀로 읽는다", () => {
    const token = signSeatPin(payload, SECRET);
    expect(verifySeatPin(token, SECRET, Date.now())).toEqual(payload);
  });

  it("비밀이 다르거나 값이 바뀌면 거절한다", () => {
    const token = signSeatPin(payload, SECRET);
    expect(verifySeatPin(token, "other", Date.now())).toBeNull();
    expect(verifySeatPin(token.slice(0, -2) + "aa", SECRET, Date.now())).toBeNull();
    expect(verifySeatPin("not-a-token", SECRET, Date.now())).toBeNull();
    expect(verifySeatPin("", SECRET, Date.now())).toBeNull();
  });

  it("만료되면 거절한다", () => {
    const expired = { ...payload, exp: Date.now() - 1 };
    expect(verifySeatPin(signSeatPin(expired, SECRET), SECRET, Date.now())).toBeNull();
  });

  it("아직 안 연 자리(JJ)는 쿠키로도 통과하지 않는다", () => {
    const token = signSeatPin({ tenantId: "t-1", seat: "jj", exp: Date.now() + 60_000 }, SECRET);
    expect(verifySeatPin(token, SECRET, Date.now())).toBeNull();
  });
});

describe("시도 횟수 제한", () => {
  const now = 1_000_000;

  it("10회까지는 허용하고 11회째는 막는다", () => {
    let w = nextPinAttempt(null, now);
    expect(w.ok).toBe(true);
    for (let i = 0; i < SEAT_PIN_RL_MAX; i++) {
      expect(w.ok).toBe(true);
      w = nextPinAttempt(recordPinFailure(w.next), now);
    }
    expect(w.ok).toBe(false);
  });

  it("창이 지나면 횟수가 리셋된다", () => {
    let w = nextPinAttempt(null, now);
    for (let i = 0; i < SEAT_PIN_RL_MAX; i++) w = nextPinAttempt(recordPinFailure(w.next), now);
    expect(w.ok).toBe(false);
    const later = nextPinAttempt(w.next, now + SEAT_PIN_RL_WINDOW_MS + 1);
    expect(later.ok).toBe(true);
    expect(later.next.count).toBe(0);
  });
});

describe("시도 제한 — 전체 상한(적대적 리뷰 2026-08-14)", () => {
  it("키별 상한과 별개로 전체 상한이 따로 센다", () => {
    // 🔴 IP별 상한만 있으면 헤더를 바꿔가며 무한 시도가 된다(4자리 = 1만 가지).
    let w = { count: SEAT_PIN_RL_GLOBAL_MAX, resetAt: 10_000 };
    expect(nextPinAttempt(w, 0, SEAT_PIN_RL_GLOBAL_MAX).ok).toBe(false);
    // 같은 창이라도 키별 상한(10)보다는 관대하다 — 정상 이용자가 먼저 막히면 안 된다.
    w = { count: SEAT_PIN_RL_MAX, resetAt: 10_000 };
    expect(nextPinAttempt(w, 0).ok).toBe(false);
    expect(nextPinAttempt(w, 0, SEAT_PIN_RL_GLOBAL_MAX).ok).toBe(true);
  });

  it("창이 지나면 전체 상한도 리셋된다", () => {
    const w = { count: SEAT_PIN_RL_GLOBAL_MAX, resetAt: 1_000 };
    const after = nextPinAttempt(w, 2_000, SEAT_PIN_RL_GLOBAL_MAX);
    expect(after.ok).toBe(true);
    expect(after.next.count).toBe(0);
  });
});
