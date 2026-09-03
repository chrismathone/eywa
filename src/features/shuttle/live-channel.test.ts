import { describe, expect, it } from "vitest";
import {
  isLivePayload,
  newSenderId,
  shouldReactTo,
  shuttleLiveChannel,
  SHUTTLE_LIVE_EVENT,
  type ShuttleLivePayload,
} from "./live-channel";

const payload = (over: Partial<ShuttleLivePayload> = {}): ShuttleLivePayload => ({
  sender: "s-other",
  kind: "boarding",
  at: 1_756_000_000_000,
  ...over,
});

describe("셔틀 실시간 채널 이름", () => {
  it("테넌트 × 날짜로 갈린다", () => {
    expect(shuttleLiveChannel("t1", "2026-09-02")).toBe("shuttle-day:t1:2026-09-02");
    // 다른 테넌트·다른 날짜는 서로를 깨우지 않는다.
    expect(shuttleLiveChannel("t1", "2026-09-02")).not.toBe(shuttleLiveChannel("t2", "2026-09-02"));
    expect(shuttleLiveChannel("t1", "2026-09-02")).not.toBe(shuttleLiveChannel("t1", "2026-09-03"));
  });

  it("시즌은 채널에 안 들어간다", () => {
    // 학기중/방학중은 보기일 뿐이고 그날 도는 건 한 벌이다 — 갈라 두면 방학 편성을 보는 사람만
    // 갱신이 안 된다.
    expect(shuttleLiveChannel("t1", "2026-09-02")).not.toContain("term");
  });
});

describe("신호 판별", () => {
  it("모양이 맞는 것만 통과한다", () => {
    expect(isLivePayload(payload())).toBe(true);
    expect(isLivePayload(payload({ kind: "trip" }))).toBe(true);
    expect(isLivePayload(payload({ kind: "exception" }))).toBe(true);
  });

  it("낯선 값에 죽지 않는다 — 채널은 누구나 아무거나 보낼 수 있다", () => {
    for (const bad of [null, undefined, 0, "changed", [], {}, { sender: "s", kind: "boarding" }]) {
      expect(isLivePayload(bad)).toBe(false);
    }
    expect(isLivePayload({ sender: 1, kind: "boarding", at: 1 })).toBe(false);
    expect(isLivePayload({ sender: "s", kind: "nope", at: 1 })).toBe(false);
  });
});

describe("내가 보낸 신호는 무시한다", () => {
  it("보낸 사람이 나면 반응하지 않는다", () => {
    // 내 화면은 액션 직후 이미 refresh했다 — 또 하면 한 번 누를 때마다 왕복이 두 번이고 화면이 깜빡인다.
    expect(shouldReactTo(payload({ sender: "me" }), "me")).toBe(false);
    expect(shouldReactTo(payload({ sender: "other" }), "me")).toBe(true);
  });
});

describe("보낸 사람 식별자", () => {
  it("탭마다 다르다", () => {
    const a = newSenderId(() => 0.1);
    const b = newSenderId(() => 0.9);
    expect(a).not.toBe(b);
  });

  it("사람 정보가 섞이지 않는다", () => {
    // 🔴 payload는 public 채널을 탄다 — 사람·학생을 식별할 수 있는 것이 들어가면 안 된다.
    expect(newSenderId(() => 0.5)).toMatch(/^s[a-z0-9]+$/);
  });
});

describe("이벤트 이름", () => {
  it("보내는 쪽·받는 쪽이 같은 상수를 쓴다", () => {
    // 갈리면 아무 일도 안 일어나고 **아무 에러도 안 난다**(조용한 고장) — 상수로 잠근다.
    expect(SHUTTLE_LIVE_EVENT).toBe("shuttle-changed");
  });
});
