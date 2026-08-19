import { describe, expect, it } from "vitest";
import {
  countProgress,
  filterByDirection,
  firstTime,
  groupRunsByVehicle,
  sumProgress,
  type RunRows,
} from "./today-board";
import type { RideRow } from "./roster";
import type { Direction, ShuttleRun, ShuttleVehicle } from "./types";

const vehicle = (id: string, name: string, sortOrder: number): ShuttleVehicle => ({
  id,
  name,
  driverName: null,
  driverPhone: null,
  sortOrder,
});

const run = (
  id: string,
  vehicleId: string,
  runNo: number,
  times: (string | null)[],
  direction: Direction = "in",
): ShuttleRun => ({
  id,
  vehicleId,
  season: "term",
  runNo,
  direction,
  label: null,
  stops: times.map((t, i) => ({
    id: `${id}-s${i}`,
    kind: "stop" as const,
    stopId: null,
    stopName: `정류장${i}`,
    stopMemo: null,
    sortOrder: i,
    atTime: t,
    riders: [],
  })),
});

const row = (key: string, status: RideRow["status"], ioKind: Direction = "in"): RideRow => ({
  key,
  runId: "r",
  runStopId: null,
  studentId: `st-${key}`,
  studentName: `학생${key}`,
  stopName: "정류장",
  atTime: "13:46",
  ioKind,
  status,
  memo: null,
  logId: status ? `log-${key}` : null,
});

describe("countProgress — 🔴 '미기록'은 미탑승이 아니다", () => {
  it("탄 것·안 탄 것·아직 안 찍은 것을 따로 센다", () => {
    const p = countProgress([row("a", "boarded"), row("b", "missed"), row("c", null)]);
    expect(p).toEqual({ planned: 3, boarded: 1, missed: 1, unmarked: 1 });
  });

  it("예정에 없던 탑승(extra)도 '탄 것' — 남은 일에서 빠져야 '완료'가 맞는다", () => {
    const p = countProgress([row("a", "extra")]);
    expect(p).toEqual({ planned: 1, boarded: 1, missed: 0, unmarked: 0 });
  });

  it("빈 명단은 0", () => {
    expect(countProgress([])).toEqual({ planned: 0, boarded: 0, missed: 0, unmarked: 0 });
  });
});

describe("groupRunsByVehicle — 호차 구분", () => {
  const vehicles = [vehicle("v1", "1호차", 0), vehicle("v2", "2호차", 1)];

  it("🔴 sortOrder가 동점(기본값 0)이면 **넘겨받은 배열 순서**를 지킨다 — 쿼리가 이름까지 정렬해 내려준다", () => {
    // 0225a의 sort_order default가 0이라 동점이 흔하다. 여기서 sortOrder만 다시 보면 쿼리의 2차 정렬
    // (.order("name"))이 버려져 편성 화면·인쇄와 호차 순서가 어긋난다.
    const tied = [vehicle("v2", "하늘차", 0), vehicle("v1", "가람차", 0)];
    const runs: RunRows[] = [
      { run: run("r1", "v1", 1, ["13:00"]), rows: [] },
      { run: run("r2", "v2", 1, ["14:00"]), rows: [] },
    ];
    expect(groupRunsByVehicle(runs, tied).map((g) => g.vehicleName)).toEqual(["하늘차", "가람차"]);
  });

  it("호차로 묶고 편성 순서로 낸다", () => {
    const runs: RunRows[] = [
      { run: run("r2", "v2", 1, ["14:00"]), rows: [row("a", null)] },
      { run: run("r1", "v1", 1, ["13:46"]), rows: [row("b", "boarded")] },
    ];
    const out = groupRunsByVehicle(runs, vehicles);
    expect(out.map((g) => g.vehicleName)).toEqual(["1호차", "2호차"]);
    expect(out[0]!.runs.map((r) => r.run.id)).toEqual(["r1"]);
  });

  it("🔴 차 안에서는 **시각 순** — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다", () => {
    const runs: RunRows[] = [
      { run: run("late", "v1", 1, ["17:40"]), rows: [] },
      { run: run("early", "v1", 3, ["13:46"]), rows: [] },
    ];
    const out = groupRunsByVehicle(runs, vehicles);
    expect(out[0]!.runs.map((r) => r.run.id)).toEqual(["early", "late"]);
  });

  it("시각이 없는 회차는 뒤로 보낸다(맨 앞이면 그날 첫 차처럼 읽힌다)", () => {
    const runs: RunRows[] = [
      { run: run("notime", "v1", 1, [null]), rows: [] },
      { run: run("timed", "v1", 5, ["15:45"]), rows: [] },
    ];
    expect(groupRunsByVehicle(runs, vehicles)[0]!.runs.map((r) => r.run.id)).toEqual([
      "timed",
      "notime",
    ]);
  });

  it("호차마다 진행을 센다 — 접힌 채로도 남은 일이 보이게", () => {
    const runs: RunRows[] = [
      { run: run("r1", "v1", 1, ["13:46"]), rows: [row("a", "boarded"), row("b", null)] },
      { run: run("r2", "v1", 2, ["15:45"]), rows: [row("c", "missed")] },
    ];
    expect(groupRunsByVehicle(runs, vehicles)[0]!.progress).toEqual({
      planned: 3,
      boarded: 1,
      missed: 1,
      unmarked: 1,
    });
  });

  it("🔴 편성에 없는 차의 회차도 **버리지 않는다** — 조용히 사라지면 그 줄은 아무도 안 찍는다", () => {
    const runs: RunRows[] = [{ run: run("orphan", "gone", 1, ["13:00"]), rows: [row("a", null)] }];
    const out = groupRunsByVehicle(runs, vehicles);
    expect(out).toHaveLength(1);
    expect(out[0]!.vehicleName).toBe("(편성 없는 차)");
  });

  it("편성에 없는 차는 맨 뒤로 (있는 차가 먼저)", () => {
    const runs: RunRows[] = [
      { run: run("orphan", "gone", 1, ["13:00"]), rows: [] },
      { run: run("r1", "v1", 1, ["14:00"]), rows: [] },
    ];
    expect(groupRunsByVehicle(runs, vehicles).map((g) => g.vehicleName)).toEqual([
      "1호차",
      "(편성 없는 차)",
    ]);
  });
});

describe("filterByDirection — 등하원 체크", () => {
  const runs: RunRows[] = [
    { run: run("in1", "v1", 1, ["13:46"], "in"), rows: [row("a", null, "in")] },
    { run: run("out1", "v1", 2, ["16:25"], "out"), rows: [row("b", null, "out")] },
  ];

  it("등원만 / 하원만 고를 수 있다", () => {
    expect(filterByDirection(runs, "in").map((r) => r.run.id)).toEqual(["in1"]);
    expect(filterByDirection(runs, "out").map((r) => r.run.id)).toEqual(["out1"]);
  });

  it("'전체'는 그대로 둔다", () => {
    expect(filterByDirection(runs, "all")).toHaveLength(2);
  });

  it("🔴 **섞인 회차**에서 반대 방향 학생을 숨기지 않는다 — 회차 direction은 탑승자 다수결이다", () => {
    // makeedu 이관이 direction을 `inn >= out`으로 정했다 → 승차 2·하차 1인 회차는 "in"으로 저장된다.
    // 회차 축으로 거르면 저녁에 '하원'을 눌렀을 때 그 1명이 통째로 사라지고 아무도 안 찍는다.
    const mixed: RunRows[] = [
      {
        run: run("mixed", "v1", 1, ["16:00"], "in"),
        rows: [row("a", null, "in"), row("b", null, "in"), row("c", null, "out")],
      },
    ];
    const out = filterByDirection(mixed, "out");
    expect(out).toHaveLength(1);
    expect(out[0]!.rows.map((r) => r.key)).toEqual(["c"]);

    const inn = filterByDirection(mixed, "in");
    expect(inn[0]!.rows.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("남은 줄이 없는 회차는 뺀다(빈 판을 그리지 않는다)", () => {
    const onlyIn: RunRows[] = [
      { run: run("r", "v1", 1, ["13:00"], "in"), rows: [row("a", null, "in")] },
    ];
    expect(filterByDirection(onlyIn, "out")).toEqual([]);
  });

  it("필터는 원본을 건드리지 않는다(같은 배열을 두 번 걸러도 결과가 같다)", () => {
    const before = runs[0]!.rows.length;
    filterByDirection(runs, "out");
    expect(runs[0]!.rows).toHaveLength(before);
  });
});

describe("sumProgress", () => {
  it("호차별 진행을 합친다", () => {
    const total = sumProgress([
      { progress: { planned: 3, boarded: 1, missed: 1, unmarked: 1 } },
      { progress: { planned: 2, boarded: 2, missed: 0, unmarked: 0 } },
    ]);
    expect(total).toEqual({ planned: 5, boarded: 3, missed: 1, unmarked: 1 });
  });
});

describe("firstTime", () => {
  it("가장 이른 시각을 HH:MM으로", () => {
    expect(firstTime(run("r", "v1", 1, ["15:45:00", "13:46:00", null]))).toBe("13:46");
  });

  it("시각이 하나도 없으면 빈 문자열", () => {
    expect(firstTime(run("r", "v1", 1, [null, null]))).toBe("");
  });
});
