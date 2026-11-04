import { describe, expect, it } from "vitest";
import { buildRunCards, ridingRiders, type WeekRideChange } from "./run-cards";
import type { ShuttleRun, ShuttleVehicle } from "./types";

const vehicles: ShuttleVehicle[] = [{ id: "v1", name: "1호차", driverName: null, driverPhone: null, sortOrder: 1 }];
const rider = (studentId: string, name: string, weekdays: string[] = [], ioKind: "in" | "out" = "in") =>
  ({ id: `r-${studentId}`, studentId, studentName: name, schoolGrade: "칠성초5", ioKind, weekdays, memo: null, studentStatus: "enrolled" }) as never;
const stop = (sortOrder: number, kind: string, name: string, atTime: string | null, riders: never[] = []) =>
  ({ id: `${name}`, kind, stopId: name, stopName: name, stopMemo: null, sortOrder, atTime, riders }) as never;

describe("buildRunCards — 회차 × 요일 배차 카드", () => {
  const runs: ShuttleRun[] = [
    {
      id: "in1", vehicleId: "v1", season: "term", runNo: 1, direction: "in", label: null,
      stops: [stop(1, "stop", "침산초 후문", "14:50:00", [rider("a", "강지호")]), stop(2, "stop", "칠성초 정문", "14:55:00", [rider("b", "김민준", ["mon"])]), stop(3, "arrive", "학원", "15:00:00")],
    },
    {
      id: "out1", vehicleId: "v1", season: "term", runNo: 2, direction: "out", label: null,
      stops: [stop(1, "depart", "학원", "18:10:00"), stop(2, "stop", "칠성초 정문", "18:20:00", [rider("b", "김민준", [], "out")]), stop(3, "stop", "침산초 후문", "18:30:00")],
    },
  ];
  const cards = buildRunCards(runs, vehicles);
  it("등원 = 첫 정류장 ~ 학원 도착 · 그 요일에 타는 아이만(노선 순서)", () => {
    const mon = cards.find((c) => c.id === "run:in1:mon")!;
    expect(mon).toMatchObject({ start: "14:50", end: "15:00", academyTime: "15:00", direction: "in", vehicleName: "1호차", runName: "1회차" });
    expect(mon.riders.map((r) => `${r.name}@${r.stopTime}`)).toEqual(["강지호@14:50", "김민준@14:55"]);
    expect(cards.find((c) => c.id === "run:in1:tue")!.riders.map((r) => r.name)).toEqual(["강지호"]);
  });
  it("하원 = 학원 출발 ~ 마지막 정류장 · 타는 아이가 없는 요일은 카드 없음", () => {
    expect(cards.find((c) => c.id === "run:out1:fri")).toMatchObject({ start: "18:10", end: "18:30", academyTime: "18:10" });
    expect(cards.filter((c) => c.runId === "out1")).toHaveLength(5);
    const empty = buildRunCards([{ ...runs[0]!, stops: [stop(1, "arrive", "학원", "15:00:00")] }], vehicles);
    expect(empty).toEqual([]);
  });
  it("🔑 한 회차에 등·하원이 섞이면 학생 줄(ioKind)대로 카드를 나눈다 — 하원 아이는 학원 출발 ~ 자기 정류장", () => {
    const loop: ShuttleRun = {
      id: "loop", vehicleId: "v1", season: "term", runNo: 1, direction: "in", label: null,
      stops: [stop(0, "depart", "학원", "14:30:00"), stop(2, "stop", "침산초 후문", "14:50:00", [rider("a", "강지호"), rider("c", "오민서", [], "out")]), stop(3, "arrive", "학원", "15:00:00")],
    };
    const got = buildRunCards([loop], vehicles).filter((c) => c.day === "mon");
    expect(got.map((c) => [c.id, c.direction, c.start, c.end, c.academyTime, c.riders.map((r) => r.name).join()])).toEqual([
      ["run:loop:mon", "in", "14:50", "15:00", "15:00", "강지호"],
      ["run:loop:out:mon", "out", "14:30", "14:50", "14:30", "오민서"],
    ]);
  });
  it("반대쪽 아이의 학원 시각 칸이 없으면 시각 미정(지어내지 않는다)", () => {
    const noDepart: ShuttleRun = {
      id: "nd", vehicleId: "v1", season: "term", runNo: 1, direction: "in", label: null,
      stops: [stop(1, "stop", "침산초 후문", "14:50:00", [rider("a", "강지호"), rider("c", "오민서", [], "out")]), stop(2, "arrive", "학원", "15:00:00")],
    };
    const outCard = buildRunCards([noDepart], vehicles).find((c) => c.id === "run:nd:out:mon")!;
    expect(outCard).toMatchObject({ direction: "out", start: null, academyTime: null, end: "14:50" });
  });

  describe("그날만 변경(사용자 2026-11-04)", () => {
    const chg = (c: Partial<WeekRideChange>): WeekRideChange =>
      ({ day: "mon", studentId: "a", studentName: "강지호", schoolGrade: "칠성초5", ioKind: "in", kind: "skip", runStopId: null, ...c }) as WeekRideChange;
    it("안 탐 = 카드에 남기고 skip 표식 · 그 요일만", () => {
      const got = buildRunCards(runs, vehicles, [chg({ kind: "skip" })]);
      expect(got.find((c) => c.id === "run:in1:mon")!.riders.find((r) => r.id === "a")!.change).toEqual({ kind: "skip" });
      expect(got.find((c) => c.id === "run:in1:tue")!.riders.find((r) => r.id === "a")!.change).toBeUndefined();
    });
    it("다른 정류장으로 = 평소 자리엔 '→ 바뀐 자리' · 바뀐 자리엔 그날만(같은 회차면 두 줄)", () => {
      const got = buildRunCards(runs, vehicles, [chg({ kind: "add", runStopId: "칠성초 정문" })]);
      const mon = got.find((c) => c.id === "run:in1:mon")!;
      expect(mon.riders.map((r) => [r.name, r.stopName, r.change?.kind ?? ""])).toEqual([
        ["강지호", "침산초 후문", "moved"],
        ["김민준", "칠성초 정문", ""],
        ["강지호", "칠성초 정문", "dayOnly"],
      ]);
      // (이 픽스처는 정류장 칸 id가 정류장 이름이라 두 회차에 겹친다 — 자리 문구는 정류장까지만 본다)
      expect(mon.riders[0]!.change).toMatchObject({ kind: "moved", to: expect.stringContaining("칠성초 정문") });
    });
    it("평소 안 타는 요일·회차에 그날만 타면 그 카드가 생긴다 · 겹침 판정 명단은 실제 타는 아이만", () => {
      const out2: ShuttleRun = {
        id: "out2", vehicleId: "v1", season: "term", runNo: 3, direction: "out", label: null,
        stops: [stop(1, "depart", "학원2", "19:10:00"), stop(2, "stop", "대성초 앞", "19:20:00")],
      };
      const got = buildRunCards([...runs, out2], vehicles, [chg({ day: "tue", studentId: "z", studentName: "오민서", ioKind: "out", kind: "add", runStopId: "대성초 앞" })]);
      expect(got.filter((c) => c.runId === "out2").map((c) => [c.id, c.riders.map((r) => `${r.name}:${r.change?.kind}`).join()])).toEqual([
        ["run:out2:tue", "오민서:dayOnly"],
      ]);
      const skipped = buildRunCards(runs, vehicles, [chg({ kind: "skip" })]).find((c) => c.id === "run:in1:mon")!;
      expect(ridingRiders(skipped).map((r) => r.name)).toEqual(["김민준"]);
    });
  });
});
