import { describe, expect, it } from "vitest";
import { studentAssignments } from "./student-assignments";
import type { ShuttleRider, ShuttleRun, ShuttleRunStop, ShuttleVehicle } from "./types";

const vehicle = (id: string, name: string): ShuttleVehicle => ({ id, name, driverName: null, driverPhone: null, sortOrder: 0 });
const rider = (id: string, studentId: string, ioKind: "in" | "out" = "in", weekdays = ["mon", "tue", "wed", "thu", "fri"]): ShuttleRider => ({
  id,
  studentId,
  studentName: `학생${studentId}`,
  schoolGrade: "",
  ioKind,
  weekdays: weekdays as ShuttleRider["weekdays"],
  memo: null,
  studentStatus: "enrolled",
});
const stop = (id: string, name: string, time: string | null, sortOrder: number, riders: ShuttleRider[] = [], kind: ShuttleRunStop["kind"] = "stop"): ShuttleRunStop => ({
  id,
  kind,
  stopId: null,
  stopName: name,
  stopMemo: null,
  sortOrder,
  atTime: time,
  riders,
});
const run = (id: string, vehicleId: string, runNo: number, direction: "in" | "out", stops: ShuttleRunStop[]): ShuttleRun => ({
  id,
  vehicleId,
  season: "term",
  runNo,
  direction,
  label: null,
  stops,
});

describe("studentAssignments — 배정된 아이가 어디에 있나", () => {
  const vehicles = [vehicle("v1", "1호차"), vehicle("v2", "2호차")];
  const runs = [
    run("eve", "v2", 2, "out", [stop("s3", "칠성초 정문", "19:00", 0, [rider("r3", "A", "out", ["mon", "wed"])])]),
    run("day", "v1", 1, "in", [
      stop("dep", "학원 출발", "14:30", 0, [], "depart"),
      stop("s1", "침산초 후문", "14:50", 1, [rider("r1", "A")]),
      stop("s2", "침산푸르지오", "14:55", 2, [rider("r2", "B")]),
    ]),
  ];
  const map = studentAssignments(runs, vehicles);

  it("한 아이의 배정을 전부 — 호차 순서 → 시각 순", () => {
    const a = map.get("A")!;
    expect(a.map((x) => [x.vehicleName, x.runName, x.direction, x.stopName, x.daysLabel])).toEqual([
      ["1호차", "1회차", "in", "침산초 후문", "평일"],
      ["2호차", "2회차", "out", "칠성초 정문", "월수"],
    ]);
    expect(a[0]!.runTime).toBe("14:30");
  });

  it("정류장 옮기기 선택지 = 같은 회차의 정류장만(학원 출발·도착 제외), 노선 순서", () => {
    expect(map.get("A")![0]!.runStops.map((s) => s.name)).toEqual(["침산초 후문", "침산푸르지오"]);
  });

  it("배정 없는 아이는 없다", () => {
    expect(map.get("Z")).toBeUndefined();
    expect(map.get("B")).toHaveLength(1);
  });
});
