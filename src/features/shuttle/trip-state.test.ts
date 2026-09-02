import { describe, expect, it } from "vitest";
import {
  canEndTrip,
  canReopenTrip,
  canStartTrip,
  runAlert,
  tripState,
  type TripState,
} from "./trip-state";
import type { Progress } from "./today-board";
import type { ShuttleTrip } from "./types";

const trip = (over: Partial<ShuttleTrip> = {}): ShuttleTrip => ({
  id: "t1",
  runId: "r1",
  startedAt: null,
  endedAt: null,
  startedByName: null,
  endedByName: null,
  memo: null,
  ...over,
});

const progress = (over: Partial<Progress> = {}): Progress => ({
  planned: 0,
  boarded: 0,
  missed: 0,
  unmarked: 0,
  ...over,
});

describe("운행 상태 — 시각에서 도출한다", () => {
  it("기록이 없으면 '출발 전'", () => {
    // 0242a 적용 전에도 모든 회차가 이 값이다. 화면은 ready로 그릴지를 따로 판단한다.
    expect(tripState(null)).toBe("ready");
    expect(tripState(undefined)).toBe("ready");
    expect(tripState(trip())).toBe("ready");
  });

  it("출발 시각만 있으면 '운행 중', 종료 시각까지 있으면 '종료'", () => {
    expect(tripState(trip({ startedAt: "2026-09-02T04:46:00Z" }))).toBe("running");
    expect(
      tripState(trip({ startedAt: "2026-09-02T04:46:00Z", endedAt: "2026-09-02T05:11:00Z" })),
    ).toBe("done");
  });

  it("출발 없이 종료만 있는 행은 '출발 전'으로 읽는다", () => {
    // DB check(shuttle_trips_end_needs_start)가 막지만, 앱이 그 행을 만나도 거짓 상태를 만들지 않는다.
    expect(tripState(trip({ endedAt: "2026-09-02T05:11:00Z" }))).toBe("ready");
  });
});

describe("관제 신호 — 지금 사람이 봐야 할 것만", () => {
  it("운행 중인데 한 명도 안 찍혔으면 '기록 없음'", () => {
    expect(runAlert("running", progress({ planned: 12, unmarked: 12 }))).toBe("stalled");
  });

  it("한 명이라도 찍혔으면 조용하다 — 미탑승도 '찍은 것'이다", () => {
    // 🔴 미기록 ≠ 미탑승. 미탑승으로 찍은 것은 기록이 들어오고 있다는 뜻이라 경보가 아니다.
    expect(runAlert("running", progress({ planned: 12, boarded: 1, unmarked: 11 }))).toBe("none");
    expect(runAlert("running", progress({ planned: 12, missed: 1, unmarked: 11 }))).toBe("none");
  });

  it("종료했는데 미기록이 남으면 '미기록 남음'", () => {
    expect(runAlert("done", progress({ planned: 12, boarded: 9, unmarked: 3 }))).toBe("left");
    expect(runAlert("done", progress({ planned: 12, boarded: 12 }))).toBe("none");
  });

  it("오늘 아무도 안 타는 회차는 어떤 신호도 내지 않는다", () => {
    // 태울 사람이 0인데 "아무도 안 찍혔다"고 하면 매일 아침 거짓 경보가 뜬다.
    for (const s of ["ready", "running", "done"] as TripState[]) {
      expect(runAlert(s, progress({ planned: 0 }))).toBe("none");
    }
  });

  it("출발 전에는 경보가 없다 — 안 찍힌 게 정상이다", () => {
    expect(runAlert("ready", progress({ planned: 12, unmarked: 12 }))).toBe("none");
  });
});

describe("출발·종료·되돌리기 가능 판정", () => {
  const today = "2026-09-02";

  it("오늘 것만 출발·종료할 수 있다", () => {
    expect(canStartTrip("ready", today, today)).toBe(true);
    expect(canEndTrip("running", today, today)).toBe(true);
    // 지난 날짜는 그날의 기록이고, 미래 날짜를 미리 출발시키면 관제가 거짓이 된다.
    expect(canStartTrip("ready", "2026-09-01", today)).toBe(false);
    expect(canStartTrip("ready", "2026-09-03", today)).toBe(false);
    expect(canEndTrip("running", "2026-09-01", today)).toBe(false);
  });

  it("상태가 맞아야 한다 — 안 떠난 차를 종료하거나 두 번 출발시키지 않는다", () => {
    expect(canStartTrip("running", today, today)).toBe(false);
    expect(canStartTrip("done", today, today)).toBe(false);
    expect(canEndTrip("ready", today, today)).toBe(false);
    expect(canEndTrip("done", today, today)).toBe(false);
  });

  it("종료는 오늘 안에서 되돌릴 수 있다", () => {
    // 잘못 누른 한 번에 그날 남은 명단을 못 찍으면 안 된다([[#103]] — 잠금은 되돌릴 문과 함께).
    expect(canReopenTrip("done", today, today)).toBe(true);
    expect(canReopenTrip("running", today, today)).toBe(false);
    expect(canReopenTrip("done", "2026-09-01", today)).toBe(false);
  });
});
