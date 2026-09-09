import { describe, expect, it } from "vitest";
import {
  acceptsResponse,
  applyRefresh,
  buildLivePayload,
  dashboardLiveChannel,
  decideFlush,
  initialLiveState,
  isDashboardLivePayload,
  metricWakesFor,
  noteFailed,
  noteRefreshed,
  noteSignal,
  REFRESH_POLICY,
  type LiveMetric,
  type MetricLiveState,
} from "./live-plan";

const T0 = 1_757_000_000_000;
const clean = (at = T0): MetricLiveState => initialLiveState(at);
const open = { hidden: false, covered: false };

describe("갱신 정책", () => {
  it("모든 지표에 폴링 바닥이 있다 — 신호가 안 붙어도 숫자가 맞는다", () => {
    // 🔴 이 계약이 이 모듈의 존재 이유다. realtime publication은 손으로 켜는 설정이라 코드가
    //    보장할 수 없고, 안 켜져 있으면 구독은 **조용히** 아무 일도 안 한다.
    for (const [metric, p] of Object.entries(REFRESH_POLICY)) {
      expect(p.everyMs, `${metric} 폴링 주기`).toBeGreaterThan(0);
    }
  });

  it("무거운 조회는 신호에 묶지 않는다 — 정각 출결 폭주에 끌려가면 화면이 멈춘다", () => {
    expect(REFRESH_POLICY.watchlist.wakenBy).toEqual([]);
    expect(REFRESH_POLICY.charts.wakenBy).toEqual([]);
    expect(REFRESH_POLICY.briefing.wakenBy).toEqual([]);
    expect(metricWakesFor("watchlist", "attendance")).toBe(false);
    expect(metricWakesFor("attendance", "attendance")).toBe(true);
  });

  it("신호를 받는 지표는 디바운스 < maxWait다(굶주림 방지가 실제로 뒤에 온다)", () => {
    for (const metric of Object.keys(REFRESH_POLICY) as LiveMetric[]) {
      const p = REFRESH_POLICY[metric];
      if (p.wakenBy.length === 0) continue;
      expect(p.debounceMs, metric).toBeGreaterThan(0);
      expect(p.maxWaitMs, metric).toBeGreaterThan(p.debounceMs);
    }
  });
});

describe("언제 집계를 돌리나", () => {
  const policy = REFRESH_POLICY.attendance; // every 60s · debounce 3s · maxWait 8s

  it("조용해지면 신호로 돌린다", () => {
    const s = noteSignal(clean(), T0 + 1_000);
    expect(decideFlush({ now: T0 + 3_500, policy, state: s, gate: open })).toBe(null);
    expect(decideFlush({ now: T0 + 4_000, policy, state: s, gate: open })).toBe("signal");
  });

  it("신호가 끊이지 않아도 maxWait에서 한 번은 돌린다", () => {
    let s = noteSignal(clean(), T0 + 1_000);
    // 1초마다 계속 들어오는 상황 — 디바운스만 있으면 영원히 안 돈다.
    for (let i = 2; i <= 9; i++) s = noteSignal(s, T0 + i * 1_000);
    expect(s.firstSignalAt).toBe(T0 + 1_000); // 창의 시작은 첫 신호로 고정
    expect(decideFlush({ now: T0 + 9_100, policy, state: s, gate: open })).toBe("signal");
  });

  it("신호가 없어도 폴링 주기가 지나면 돌린다", () => {
    const s = clean();
    expect(decideFlush({ now: T0 + 59_000, policy, state: s, gate: open })).toBe(null);
    expect(decideFlush({ now: T0 + 60_000, policy, state: s, gate: open })).toBe("poll");
  });

  it("다른 탭이거나 창에 가려져 있으면 돌리지 않는다 — dirty만 쌓인다", () => {
    const s = noteSignal(clean(), T0 + 1_000);
    const later = T0 + 600_000; // 폴링 주기도 한참 지난 시점
    expect(decideFlush({ now: later, policy, state: s, gate: { hidden: true, covered: false } })).toBe(null);
    expect(decideFlush({ now: later, policy, state: s, gate: { hidden: false, covered: true } })).toBe(null);
    // 다시 보이면 그때 한 번에 나간다.
    expect(decideFlush({ now: later, policy, state: s, gate: open })).toBe("signal");
  });

  it("성공한 갱신만 dirty를 턴다", () => {
    const s = noteRefreshed(noteSignal(clean(), T0 + 1_000), T0 + 5_000);
    expect(s.dirty).toBe(false);
    expect(s.lastRefreshAt).toBe(T0 + 5_000);
    expect(decideFlush({ now: T0 + 5_100, policy, state: s, gate: open })).toBe(null);
  });

  it("실패는 dirty를 안 턴다 — 그 변경이 조용히 사라지지 않는다", () => {
    const s = noteFailed(noteSignal(clean(), T0 + 1_000), T0 + 5_000);
    expect(s.dirty).toBe(true);
    expect(s.lastRefreshAt).toBe(T0); // 보여 주는 값은 여전히 옛것이다
  });

  it("실패 뒤엔 한 주기를 쉰다 — 고장난 조회를 초당 두들기지 않는다", () => {
    // 🔴 이걸 안 넣으면 dirty가 남은 채 debounce 조건이 계속 참이라 매 tick마다 다시 쏜다.
    const s = noteFailed(noteSignal(clean(), T0 + 1_000), T0 + 5_000);
    expect(decideFlush({ now: T0 + 9_000, policy, state: s, gate: open })).toBe(null);
    expect(decideFlush({ now: T0 + 64_900, policy, state: s, gate: open })).toBe(null);
    expect(decideFlush({ now: T0 + 65_000, policy, state: s, gate: open })).toBe("signal");
  });

  it("폴링도 성공이 아니라 **시도** 시각으로 잰다", () => {
    const s = noteFailed(clean(), T0 + 30_000);
    // 성공 시각(T0)으로 재면 T0+60s에 벌써 쏘지만, 시도 시각(T0+30s)으로 재면 T0+90s다.
    expect(decideFlush({ now: T0 + 61_000, policy, state: s, gate: open })).toBe(null);
    expect(decideFlush({ now: T0 + 91_000, policy, state: s, gate: open })).toBe("poll");
  });
});

describe("응답 순서와 실패", () => {
  it("늦게 온 응답이 최신 숫자를 덮지 않는다", () => {
    expect(acceptsResponse(7, 6)).toBe(true);
    expect(acceptsResponse(5, 6)).toBe(false); // 먼저 보냈지만 늦게 도착한 것
    expect(acceptsResponse(6, 6)).toBe(false);
  });

  it("갱신 실패를 0으로 그리지 않는다 — 마지막 성공값을 두고 낡았다고만 적는다", () => {
    const prev = { value: 12, at: T0, stale: false };
    expect(applyRefresh(prev, { ok: false })).toEqual({ value: 12, at: T0, stale: true });
    expect(applyRefresh(prev, { ok: true, value: 9, at: T0 + 1_000 })).toEqual({
      value: 9,
      at: T0 + 1_000,
      stale: false,
    });
  });
});

describe("신호 채널", () => {
  it("테넌트 하나에 채널 하나 — 반마다 구독하지 않는다", () => {
    expect(dashboardLiveChannel("injaewon")).toBe("dashboard:injaewon");
  });

  it("낯선 payload에 죽지 않는다", () => {
    expect(isDashboardLivePayload({ area: "attendance", at: T0 })).toBe(true);
    expect(isDashboardLivePayload({ area: "attendance" })).toBe(false);
    expect(isDashboardLivePayload({ area: "학생", at: T0 })).toBe(false);
    expect(isDashboardLivePayload(null)).toBe(false);
    expect(isDashboardLivePayload("attendance")).toBe(false);
  });

  it("보내는 payload에 실리는 것은 영역과 시각뿐이다 — 사람·학생 정보가 채널에 흐르지 않는다", () => {
    // 🔴 실제로 나가는 객체의 키를 센다 — 누가 payload에 이름·id를 얹으면 여기서 깨진다
    //    (타입만으로는 필드 추가를 못 막는다).
    expect(Object.keys(buildLivePayload("students", T0)).sort()).toEqual(["area", "at"]);
    expect(buildLivePayload("students", T0)).toEqual({ area: "students", at: T0 });
  });
});
