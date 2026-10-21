import { describe, expect, it } from "vitest";
import { RIDE_SEARCH_LIMIT, searchRides } from "./ride-search";
import type { VehicleGroup } from "./today-board";
import type { RideRow } from "../roster";
import type { ShuttleRun } from "../types";

const run = (id: string, time: string): ShuttleRun => ({
  id,
  vehicleId: "v",
  season: "term",
  runNo: 1,
  direction: "in",
  label: null,
  stops: [{ id: `${id}-s`, kind: "stop", stopId: null, stopName: "정류장", stopMemo: null, sortOrder: 0, atTime: time, riders: [] }],
});

const row = (key: string, name: string, atTime: string | null = null, ioKind: "in" | "out" = "in"): RideRow => ({
  key,
  runId: "r",
  runStopId: null,
  studentId: `st-${key}`,
  studentName: name,
  stopName: "칠성초 정문",
  atTime,
  ioKind,
  status: null,
  memo: null,
  logId: null,
  dayKind: "regular",
  exceptionMemo: null,
  exceptionId: null,
});

const group = (key: string, name: string, runs: VehicleGroup["runs"]): VehicleGroup => ({
  vehicleId: key,
  key: `name:${name}`,
  vehicleIds: [key],
  vehicleName: name,
  driverName: null,
  driverPhone: null,
  runs,
  progress: { planned: 0, boarded: 0, missed: 0, unmarked: 0 },
});

describe("searchRides — 학생 찾아가기", () => {
  const groups = [
    group("v1", "1호차", [{ run: run("r1", "14:30"), rows: [row("a", "김효빈", "14:35"), row("b", "박서준")] }]),
    group("v2", "2호차", [
      { run: run("r2", "15:10"), rows: [row("c", "김효빈", null)] },
      { run: run("r3", "19:00"), rows: [row("d", "김효빈", "19:05", "out")] },
    ]),
  ];

  it("빈 검색어는 아무것도 안 낸다(전원을 내면 목록이 화면을 덮는다)", () => {
    expect(searchRides(groups, "")).toEqual([]);
    expect(searchRides(groups, "   ")).toEqual([]);
  });

  it("🔑 한 학생이 여러 회차를 타면 줄마다 하나씩 — 호차·시각 순", () => {
    const hits = searchRides(groups, "효빈");
    expect(hits.map((h) => [h.vehicleName, h.time, h.ioKind])).toEqual([
      ["1호차", "14:35", "in"],
      ["2호차", "15:10", "in"], // 줄 시각이 없으면 회차 첫 시각
      ["2호차", "19:05", "out"],
    ]);
    expect(hits[1]!.vehicleKey).toBe("name:2호차");
    expect(hits[0]!.rowKey).toBe("a");
  });

  it("공백·대소문자는 무시한다(출석부 검색과 같은 판정)", () => {
    expect(searchRides(groups, "박 서준").map((h) => h.rowKey)).toEqual(["b"]);
  });

  it("상한을 넘기지 않는다", () => {
    const many = group("v", "3호차", [{ run: run("x", "13:00"), rows: Array.from({ length: 20 }, (_, i) => row(`k${i}`, `이학생${i}`)) }]);
    expect(searchRides([many], "이학생")).toHaveLength(RIDE_SEARCH_LIMIT);
  });
});
