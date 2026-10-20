import { describe, expect, it } from "vitest";
import {
  alertRuns,
  buildLiveBoard,
  nearestRunId,
  progressLabel,
  shouldExpand,
  summarizeLive,
} from "./live-board";
import type { VehicleGroup } from "../today/today-board";
import type { RideRow } from "../roster";
import type { ShuttleRun, ShuttleTrip } from "../types";

const run = (id: string, runNo: number): ShuttleRun => ({
  id,
  vehicleId: "v1",
  season: "term",
  runNo,
  direction: "in",
  label: null,
  stops: [],
});

let seq = 0;
const row = (status: RideRow["status"], over: Partial<RideRow> = {}): RideRow => ({
  key: `k${++seq}`,
  runId: "r1",
  runStopId: "rs1",
  studentId: `s${seq}`,
  studentName: "학생",
  stopName: "정류장",
  atTime: "13:46",
  ioKind: "in",
  status,
  memo: null,
  logId: status ? `l${seq}` : null,
  dayKind: "regular",
  exceptionMemo: null,
  exceptionId: null,
  ...over,
});

/** today-board가 만들어 넘기는 모양 — 진행은 rows에서 다시 센다. */
const group = (over: Partial<VehicleGroup> = {}): VehicleGroup => ({
  vehicleId: "v1",
  vehicleName: "1호차",
  driverName: "곽기사",
  driverPhone: "010-0000-0000",
  runs: [],
  progress: { planned: 0, boarded: 0, missed: 0, unmarked: 0 },
  ...over,
});

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

describe("관제 한 벌 만들기", () => {
  it("운행 기록이 없으면 전부 '출발 전'", () => {
    const board = buildLiveBoard(
      [group({ runs: [{ run: run("r1", 1), rows: [row(null), row(null)] }] })],
      new Map(),
    );
    expect(board[0]!.runs[0]!.state).toBe("ready");
    expect(board[0]!.runs[0]!.trip).toBeNull();
    // 출발 전에는 안 찍힌 게 정상이라 경보가 없다.
    expect(board[0]!.runs[0]!.alert).toBe("none");
  });

  it("출발했는데 한 명도 안 찍히면 그 회차에 경보가 선다", () => {
    const board = buildLiveBoard(
      [group({ runs: [{ run: run("r1", 1), rows: [row(null), row(null)] }] })],
      new Map([["r1", trip({ startedAt: "2026-09-02T04:46:00Z" })]]),
    );
    expect(board[0]!.runs[0]!.state).toBe("running");
    expect(board[0]!.runs[0]!.alert).toBe("stalled");
    expect(board[0]!.running).toBe(1);
    expect(board[0]!.alerts).toBe(1);
  });

  it("종료했는데 미기록이 남으면 경보가 선다", () => {
    const board = buildLiveBoard(
      [group({ runs: [{ run: run("r1", 1), rows: [row("boarded"), row(null)] }] })],
      new Map([
        ["r1", trip({ startedAt: "2026-09-02T04:46:00Z", endedAt: "2026-09-02T05:11:00Z" })],
      ]),
    );
    expect(board[0]!.runs[0]!.state).toBe("done");
    expect(board[0]!.runs[0]!.alert).toBe("left");
  });

  it("진행은 today-board와 같은 방식으로 센다 — 미기록과 미탑승을 합치지 않는다", () => {
    const board = buildLiveBoard(
      [
        group({
          runs: [{ run: run("r1", 1), rows: [row("boarded"), row("missed"), row(null)] }],
        }),
      ],
      new Map(),
    );
    expect(board[0]!.runs[0]!.progress).toEqual({
      planned: 3,
      boarded: 1,
      missed: 1,
      unmarked: 1,
    });
  });

  it("오늘 안 타는 줄(skipped)은 진행에서 빠진다", () => {
    const board = buildLiveBoard(
      [
        group({
          runs: [{ run: run("r1", 1), rows: [row("boarded"), row(null, { dayKind: "skipped" })] }],
        }),
      ],
      new Map(),
    );
    expect(board[0]!.runs[0]!.progress.planned).toBe(1);
    // 남은 일이 0이므로 종료해도 '미기록 남음'이 아니다.
    expect(board[0]!.runs[0]!.progress.unmarked).toBe(0);
  });

  it("차·회차 순서를 바꾸지 않는다 — 경보를 위로 올리지 않는다", () => {
    // 볼 때마다 줄 순서가 바뀌면 "아까 그 차가 어디 갔지"가 된다(모듈 머리 주석).
    const board = buildLiveBoard(
      [
        group({
          runs: [
            { run: run("r1", 1), rows: [row("boarded")] },
            { run: run("r2", 2), rows: [row(null)] },
          ],
        }),
      ],
      new Map([["r2", trip({ startedAt: "2026-09-02T06:00:00Z" })]]),
    );
    expect(board[0]!.runs.map((r) => r.run.id)).toEqual(["r1", "r2"]);
    expect(board[0]!.runs[1]!.alert).toBe("stalled");
  });
});

describe("상단 요약", () => {
  it("상태별 회차 수와 전체 진행을 센다", () => {
    const board = buildLiveBoard(
      [
        group({
          runs: [
            { run: run("r1", 1), rows: [row("boarded")] },
            { run: run("r2", 2), rows: [row(null)] },
            { run: run("r3", 3), rows: [row("boarded"), row(null)] },
          ],
          progress: { planned: 4, boarded: 2, missed: 0, unmarked: 2 },
        }),
      ],
      new Map([
        ["r1", trip({ startedAt: "2026-09-02T04:00:00Z", endedAt: "2026-09-02T04:30:00Z" })],
        ["r2", trip({ startedAt: "2026-09-02T06:00:00Z" })],
      ]),
    );
    const s = summarizeLive(board);
    expect(s.vehicles).toBe(1);
    expect(s.done).toBe(1);
    expect(s.running).toBe(1);
    expect(s.ready).toBe(1);
    expect(s.alerts).toBe(1); // r2 = 출발했는데 기록 0
    expect(s.progress).toEqual({ planned: 4, boarded: 2, missed: 0, unmarked: 2 });
  });

  it("빈 화면에서도 0으로 답한다", () => {
    expect(summarizeLive([])).toEqual({
      vehicles: 0,
      ready: 0,
      running: 0,
      done: 0,
      alerts: 0,
      progress: { planned: 0, boarded: 0, missed: 0, unmarked: 0 },
    });
  });
});

describe("경보 목록", () => {
  it("경보 회차를 차 정보와 함께 뽑는다", () => {
    const board = buildLiveBoard(
      [group({ runs: [{ run: run("r1", 1), rows: [row(null)] }] })],
      new Map([["r1", trip({ startedAt: "2026-09-02T04:46:00Z" })]]),
    );
    const alerts = alertRuns(board);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.vehicle.vehicleName).toBe("1호차");
    expect(alerts[0]!.run.run.id).toBe("r1");
    // 🔴 원래 목록에서 빼지 않는다 — 두 자리에서 동시에 사라지면 안 된다.
    expect(board[0]!.runs).toHaveLength(1);
  });
});

describe("표시 헬퍼", () => {
  it("진행 문구는 '찍은 것/예정'이다", () => {
    // 분자는 탑승+미탑승 = **찍은 것**이다(미기록은 아직 안 한 일).
    expect(progressLabel({ planned: 12, boarded: 8, missed: 1, unmarked: 3 })).toBe("9/12");
  });

  it("운행 중이거나 볼 것이 있으면 펼친다", () => {
    expect(shouldExpand({ state: "running", alert: "none" })).toBe(true);
    expect(shouldExpand({ state: "done", alert: "left" })).toBe(true);
    expect(shouldExpand({ state: "done", alert: "none" })).toBe(false);
    expect(shouldExpand({ state: "ready", alert: "none" })).toBe(false);
  });
});

describe("nearestRunId — 호차를 눌렀을 때 기본 회차", () => {
  const timed = (id: string, at: string | null, state: "ready" | "running" | "done" = "ready") => ({
    run: { ...run(id, 1), stops: at ? [{ id: `${id}-s`, kind: "depart" as const, stopId: null, stopName: "", stopMemo: null, sortOrder: 1, atTime: `${at}:00`, riders: [] }] : [] },
    state,
  });
  const runs = [timed("a", "14:30"), timed("b", "16:00"), timed("c", "19:00"), timed("x", null)];

  it("운행 중인 회차가 먼저", () => {
    expect(nearestRunId([timed("a", "14:30"), timed("b", "16:00", "running")], 14 * 60 + 30)).toBe("b");
  });
  it("지금과 출발 시각이 가장 가까운 회차(앞뒤 상관없이)", () => {
    expect(nearestRunId(runs, 15 * 60 + 50)).toBe("b"); // 16:00이 10분 차
    expect(nearestRunId(runs, 15 * 60)).toBe("a"); // 14:30(30분) < 16:00(60분)
    expect(nearestRunId(runs, 21 * 60)).toBe("c");
  });
  it("같은 차이면 앞으로 올 회차, 시각이 없으면 첫 회차", () => {
    expect(nearestRunId(runs, 15 * 60 + 15)).toBe("b"); // 14:30·16:00 둘 다 45분 → 앞으로 올 16:00
    expect(nearestRunId([timed("x", null), timed("y", null)], 600)).toBe("x");
    expect(nearestRunId([], 600)).toBeNull();
  });
});
