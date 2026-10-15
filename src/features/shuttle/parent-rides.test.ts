import { describe, expect, it } from "vitest";
import {
  buildRideLegs,
  buildVehicleRoutes,
  dayRunsEndTime,
  parentLegView,
  regularRunClosed,
  ridePairConflict,
  runEditClosed,
  runStartTime,
  weekDates,
  type RideLeg,
} from "./parent-rides";

describe("ridePairConflict — 등원·하원 짝 규칙", () => {
  const out1830 = { runId: "run2", time: "18:30" };
  it("같은 회차는 시각과 무관하게 막는다", () => {
    expect(ridePairConflict("in", { runId: "run2", time: "18:20" }, out1830)).toMatch("같은 회차");
    expect(ridePairConflict("out", { runId: "run1", time: "14:40" }, { runId: "run1", time: "14:30" })).toMatch("같은 회차");
  });
  it("등원은 하원보다 빨라야 한다(같은 시각도 안 됨)", () => {
    expect(ridePairConflict("in", { runId: "run1", time: "14:40" }, out1830)).toBeNull();
    expect(ridePairConflict("in", { runId: "run3", time: "19:00" }, out1830)).toMatch("18:30");
    expect(ridePairConflict("in", { runId: "run3", time: "18:30" }, out1830)).not.toBeNull();
  });
  it("하원은 등원보다 늦어야 한다", () => {
    const in1440 = { runId: "run1", time: "14:40" };
    expect(ridePairConflict("out", { runId: "run2", time: "18:30" }, in1440)).toBeNull();
    expect(ridePairConflict("out", { runId: "run0", time: "13:00" }, in1440)).toMatch("14:40");
  });
  it("상대가 없거나 시각을 모르면 시각으로는 막지 않는다", () => {
    expect(ridePairConflict("in", { runId: "run3", time: "19:00" }, null)).toBeNull();
    expect(ridePairConflict("in", { runId: "run3", time: null }, out1830)).toBeNull();
    expect(ridePairConflict("in", { runId: "run3", time: "19:00" }, { runId: "run2", time: null })).toBeNull();
  });
});
import type { ShuttleRun } from "./types";

const YMD = "2026-09-26"; // 토요일

const leg = (over: Partial<RideLeg>): RideLeg => ({
  key: "k", studentId: "s1", direction: "in", vehicleId: "v1", runId: "r1", vehicleName: "1호차", runName: "1회차", stopName: "칠성초 정문",
  plannedTime: "14:40", skipped: false, added: false, status: null, recordedTime: null, notifyParent: true,
  trip: "ready", tripStartedTime: null, tripEndedTime: null, staffMemo: null, route: [], ...over,
});

describe("weekDates — 운영 주 월~금", () => {
  it("평일이면 그 주 월~금(주말 없음)", () => {
    const w = weekDates("2026-09-23"); // 수요일
    expect(w.map((x) => x.day)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(w[0]!.ymd).toBe("2026-09-21");
    expect(w[4]!.ymd).toBe("2026-09-25");
  });

  it("토·일이면 다음 주 월~금", () => {
    expect(weekDates(YMD)[0]!.ymd).toBe("2026-09-28"); // 토
    expect(weekDates("2026-09-27")[0]!.ymd).toBe("2026-09-28"); // 일
  });
});

describe("parentLegView — 학부모에게 보이는 한 줄", () => {
  it("기록이 없고 출발 전이면 '예정'이다(미탑승이라고 말하지 않는다)", () => {
    expect(parentLegView(leg({})).headline).toBe("14:40 칠성초 정문에서 탈 예정이에요");
    expect(parentLegView(leg({ direction: "out" })).headline).toBe("14:40 칠성초 정문에서 내릴 예정이에요");
  });

  it("운행 표를 모르면(null) 운행 상태를 지어내지 않고 예정으로 둔다", () => {
    expect(parentLegView(leg({ trip: null })).tone).toBe("inert");
  });

  it("운행 중인데 아직 안 찍혔으면 '운행 중'", () => {
    const v = parentLegView(leg({ trip: "running" }));
    expect(v.headline).toBe("셔틀이 운행 중이에요");
    expect(v.tone).toBe("info");
  });

  it("탔으면 찍은 시각·정류장, 운행이 끝났으면 학원 도착 시각까지", () => {
    const v = parentLegView(leg({ status: "boarded", recordedTime: "14:41", trip: "done", tripEndedTime: "15:02" }));
    expect(v.headline).toBe("14:41 칠성초 정문에서 탔어요");
    expect(v.detail).toBe("15:02 학원에 도착했어요");
    expect(v.tone).toBe("positive");
  });

  it("하원은 '내렸어요'", () => {
    expect(parentLegView(leg({ direction: "out", status: "boarded", recordedTime: "18:21" })).headline).toBe(
      "18:21 칠성초 정문에서 내렸어요",
    );
  });

  it("오늘 안 탐은 직원 메모를 싣지 않는다", () => {
    const v = parentLegView(leg({ skipped: true, staffMemo: "어머니가 직접 데리러 옴" }));
    expect(v.headline).toBe("등원차를 타지 않습니다");
    expect(parentLegView(leg({ skipped: true, direction: "out" })).headline).toBe("하원차를 탑승하지 않습니다");
    expect(JSON.stringify(v)).not.toContain("어머니");
  });

  it("미탑승·운행 끝났는데 기록 없음은 주의(caution)", () => {
    expect(parentLegView(leg({ status: "missed" })).tone).toBe("caution");
    expect(parentLegView(leg({ trip: "done" })).headline).toBe("탑승 기록이 없어요");
    // 지난 날 — 기록은 그대로, "오늘"·"예정"만 바뀐다.
    expect(parentLegView(leg({ status: "missed" }), { past: true }).headline).toBe("등원 셔틀을 타지 않았어요");
    expect(parentLegView(leg({ trip: null }), { past: true }).headline).toBe("탑승 기록이 없어요");
    expect(parentLegView(leg({ status: "boarded", recordedTime: "14:41" }), { past: true }).headline).toContain("14:41");
  });
});

describe("buildRideLegs — 아이별 구간", () => {
  const run: ShuttleRun = {
    id: "r1", vehicleId: "v1", season: "term", runNo: 1, direction: "in", label: null,
    stops: [{
      id: "rs1", kind: "stop", stopId: "st1", stopName: "칠성초 정문", stopMemo: null, sortOrder: 1, atTime: "14:40",
      riders: [
        { id: "a", studentId: "s1", studentName: "김민준", schoolGrade: "칠성초5", ioKind: "in", weekdays: ["sat"], memo: null, studentStatus: "enrolled" },
        { id: "b", studentId: "s2", studentName: "이서연", schoolGrade: "칠성초6", ioKind: "in", weekdays: ["mon"], memo: null, studentStatus: "enrolled" },
      ],
    }],
  };

  it("요일이 맞는 아이만, 찍은 시각을 KST로 붙인다", () => {
    const legs = buildRideLegs({
      ymd: YMD, runs: [run], vehicles: [{ id: "v1", name: "1호차" }], exceptions: [],
      logs: [{ id: "l1", studentId: "s1", runId: "r1", ioKind: "in", status: "boarded", memo: null, recordedAt: "2026-09-26T05:41:00Z" }],
      trips: new Map(), tripsReady: true,
    });
    expect([...legs.keys()]).toEqual(["s1"]); // s2는 월요일만
    const l = legs.get("s1")![0]!;
    expect(l.recordedTime).toBe("14:41");
    expect(l.vehicleName).toBe("1호차");
    expect(l.trip).toBe("ready");
    expect(l.route).toEqual([{ id: "rs1", kind: "stop", name: "칠성초 정문", time: "14:40", mine: true }]);
  });

  it("예정 없는 회차의 기록은 탔을 때만 구간이 된다(옛 회차 '미탑승'이 두 번째 등원으로 뜨지 않게)", () => {
    const other: ShuttleRun = { ...run, id: "r2", runNo: 2, stops: [{ ...run.stops[0]!, id: "rs2", riders: [] }] };
    const legs = buildRideLegs({
      ymd: YMD, runs: [run, other], vehicles: [], exceptions: [],
      logs: [{ id: "l2", studentId: "s1", runId: "r2", ioKind: "in", status: "missed", memo: null, recordedAt: null }],
      trips: new Map(), tripsReady: true,
    });
    expect(legs.get("s1")!.map((l) => l.runId)).toEqual(["r1"]);
    const boarded = buildRideLegs({
      ymd: YMD, runs: [run, other], vehicles: [], exceptions: [],
      logs: [{ id: "l2", studentId: "s1", runId: "r2", ioKind: "in", status: "extra", memo: null, recordedAt: null }],
      trips: new Map(), tripsReady: true,
    });
    // 다른 회차에서 실제로 탔으면 그게 그날 등원이다 — 예정만 있는 r1 줄은 두 번째 등원으로 서지 않는다.
    expect(boarded.get("s1")!.map((l) => l.runId)).toEqual(["r2"]);
  });

  it("오늘 1회차로 탄 뒤 고정시간을 2회차로 옮겨도 등원 구간은 하나(사용자 2026-09-30)", () => {
    // 고정 배정은 이제 r2(18:20), 오늘 기록은 옛 고정 r1에서 '탔음'.
    const moved: ShuttleRun = { ...run, stops: [{ ...run.stops[0]!, riders: [] }] };
    const r2: ShuttleRun = {
      ...run, id: "r2", runNo: 2,
      stops: [{ ...run.stops[0]!, id: "rs2", atTime: "18:20", riders: run.stops[0]!.riders }],
    };
    const legs = buildRideLegs({
      ymd: YMD, runs: [moved, r2], vehicles: [], exceptions: [],
      logs: [{ id: "l1", studentId: "s1", runId: "r1", ioKind: "in", status: "boarded", memo: null, stopLabel: "칠성초 정문", recordedAt: null }],
      trips: new Map(), tripsReady: true,
    });
    const ins = legs.get("s1")!.filter((l) => l.direction === "in");
    expect(ins.map((l) => [l.runId, l.status])).toEqual([["r1", "boarded"]]);
    // 예정 없는 기록 줄도 기록의 정류장으로 노선 칸을 찾아 시각·'여기서 타요'를 되찾는다(밑으로 안 밀린다).
    expect(ins[0]!.plannedTime).toBe("14:40");
    expect(ins[0]!.route.filter((s) => s.mine).map((s) => s.id)).toEqual(["rs1"]);
  });

  it("운행 표가 준비 안 됐으면 trip은 null(모름)", () => {
    const legs = buildRideLegs({
      ymd: YMD, runs: [run], vehicles: [], exceptions: [], logs: [], trips: new Map(), tripsReady: false,
    });
    expect(legs.get("s1")![0]!.trip).toBeNull();
  });
});

describe("runEditClosed — 회차 출발 10분 전 마감", () => {
  const T = "2026-09-29";
  const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  it("오늘: 출발 10분 전부터 마감", () => {
    expect(runEditClosed("14:30", T, T, at("14:19"))).toBe(false);
    expect(runEditClosed("14:30", T, T, at("14:20"))).toBe(true);
    expect(runEditClosed("14:30", T, T, at("15:00"))).toBe(true);
  });

  it("앞으로의 날짜는 열림, 지난 날짜는 마감", () => {
    expect(runEditClosed("14:30", "2026-09-30", T, at("23:59"))).toBe(false);
    expect(runEditClosed("14:30", "2026-09-28", T, at("00:00"))).toBe(true);
  });

  it("시작 시각을 모르면 막지 않는다", () => {
    expect(runEditClosed(null, T, T, at("23:59"))).toBe(false);
  });

  it("시작 시각 = 학원 출발 칸, 없으면 첫 시각", () => {
    expect(runStartTime([{ kind: "stop", time: "14:40" }, { kind: "depart", time: "14:30" }])).toBe("14:30");
    expect(runStartTime([{ kind: "depart", time: null }, { kind: "stop", time: "18:20" }])).toBe("18:20");
    expect(runStartTime([{ kind: "depart", time: null }])).toBeNull();
  });
});

describe("buildVehicleRoutes — 호차별 전체 노선", () => {
  const stop = (id: string, sortOrder: number, atTime: string | null) => ({
    id, kind: "stop" as const, stopId: null, stopName: id, stopMemo: null, sortOrder, atTime, riders: [],
  });
  const run = (id: string, vehicleId: string, stops: ShuttleRun["stops"]): ShuttleRun => ({
    id, vehicleId, season: "term", runNo: 1, direction: "out", label: null, stops,
  });

  it("차량별로 묶고, 회차는 학원 출발 시각 순 · 정류장은 순서대로 · 배정은 싣지 않는다", () => {
    const routes = buildVehicleRoutes([
      run("late", "v1", [stop("b", 2, "18:20"), stop("a", 1, "18:10")]),
      run("untimed", "v1", [{ ...stop("dep0", 0, null), kind: "depart" }]),
      run("early", "v1", [stop("c", 1, "14:40"), { ...stop("dep", 0, "14:30"), kind: "depart" }]),
      run("other", "v2", [stop("d", 1, "15:00")]),
    ]);
    expect(routes.get("v1")!.map((r) => r.runId)).toEqual(["early", "late", "untimed"]);
    expect(routes.get("v1")!.map((r) => r.departTime)).toEqual(["14:30", null, null]);
    expect(routes.get("v1")![1]!.stops).toEqual([ // late
      { id: "a", kind: "stop", name: "a", time: "18:10" },
      { id: "b", kind: "stop", name: "b", time: "18:20" },
    ]);
    expect(routes.get("v2")!.map((r) => r.runId)).toEqual(["other"]);
  });
});

describe("regularRunClosed — 고정 시간 변경: 오늘 지난 회차는 못 고르고, 운행이 다 끝나면 다시", () => {
  const T = "2026-09-30";
  const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const END = "18:40";

  it("오늘: 출발 10분 전부터 닫힘", () => {
    expect(regularRunClosed("14:30", END, T, T, at("14:19"))).toBe(false);
    expect(regularRunClosed("14:30", END, T, T, at("14:20"))).toBe(true);
    expect(regularRunClosed("14:30", END, T, T, at("18:39"))).toBe(true);
  });

  it("오늘 운행이 모두 끝나면 다시 전부 열림", () => {
    expect(regularRunClosed("14:30", END, T, T, at("18:40"))).toBe(false);
    expect(regularRunClosed("14:30", END, T, T, at("22:00"))).toBe(false);
  });

  it("다른 요일(가장 가까운 날이 오늘이 아님)은 늘 열림", () => {
    expect(regularRunClosed("14:30", END, "2026-10-01", T, at("15:00"))).toBe(false);
  });

  it("시각을 모르면 막지 않는다 · 마지막 시각을 모르면 운행 중으로 본다", () => {
    expect(regularRunClosed(null, END, T, T, at("15:00"))).toBe(false);
    expect(regularRunClosed("14:30", null, T, T, at("15:00"))).toBe(true);
  });
});

describe("dayRunsEndTime — 그날 모든 회차의 마지막 시각", () => {
  it("가장 늦은 칸 시각, 시각이 없으면 null", () => {
    expect(dayRunsEndTime([
      { stops: [{ time: "14:30" }, { time: "15:10" }] },
      { stops: [{ time: null }, { time: "18:40" }] },
    ])).toBe("18:40");
    expect(dayRunsEndTime([{ stops: [{ time: null }] }])).toBeNull();
  });
});
