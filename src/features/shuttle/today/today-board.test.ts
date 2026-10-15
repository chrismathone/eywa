import { describe, expect, it } from "vitest";
import {
  countProgress,
  filterByDirection,
  firstTime,
  groupRunsByVehicle,
  progressState,
  sumProgress,
  type RunRows,
  groupRowsByStop,
  stopGroupRemaining,
  splitRowsByIo,
} from "./today-board";
import type { RideRow } from "../roster";
import type { Direction, ShuttleRun, ShuttleVehicle } from "../types";

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

const row = (
  key: string,
  status: RideRow["status"],
  ioKind: Direction = "in",
  dayKind: RideRow["dayKind"] = "regular",
): RideRow => ({
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
  dayKind,
  exceptionMemo: null,
  exceptionId: dayKind === "regular" ? null : `exc-${key}`,
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

// ── 일회성 탑승 개입(0229a)이 진행 카운트에 미치는 영향 ─────────────────────────────────
describe("countProgress — 🔴 '오늘 안 탐'은 할 일이 아니다", () => {
  it("skip 줄은 planned에서도 빠진다 — 안 그러면 '남음 1명'이 영원히 안 줄어든다", () => {
    const rows = [row("a", "boarded"), row("b", null, "in", "skipped")];
    expect(countProgress(rows)).toEqual({ planned: 1, boarded: 1, missed: 0, unmarked: 0 });
  });

  it("불변식 planned = boarded + missed + unmarked 를 지킨다", () => {
    const rows = [
      row("a", "boarded"),
      row("b", "missed"),
      row("c", null),
      row("d", null, "in", "skipped"),
      row("e", "boarded", "in", "skipped"), // 뒤늦게 skip이 들어온 줄(드문 경우)
    ];
    const p = countProgress(rows);
    expect(p.planned).toBe(p.boarded + p.missed + p.unmarked);
    expect(p).toEqual({ planned: 3, boarded: 1, missed: 1, unmarked: 1 });
  });

  it("'오늘만 탑승'(added)은 평소 줄과 똑같이 센다 — 실제로 태워야 하는 사람이다", () => {
    const rows = [row("a", null, "in", "added"), row("b", "boarded", "in", "added")];
    expect(countProgress(rows)).toEqual({ planned: 2, boarded: 1, missed: 0, unmarked: 1 });
  });
});

describe("progressState — 전원이 오늘 안 타면 '완료'가 아니다", () => {
  it("아무도 안 태우는 회차는 none — 다 한 것처럼 읽히면 안 된다", () => {
    expect(progressState(countProgress([row("a", null, "in", "skipped")]))).toBe("none");
  });
  it("남은 줄이 있으면 remaining, 다 찍었으면 done", () => {
    expect(progressState(countProgress([row("a", null)]))).toBe("remaining");
    expect(progressState(countProgress([row("a", "boarded")]))).toBe("done");
  });
  it("줄이 아예 없어도 none(빈 묶음)", () => {
    expect(progressState(countProgress([]))).toBe("none");
  });
});

describe("groupRowsByStop — 정류장으로 묶어 이름 반복을 없앤다", () => {
  /** 노선 칸·정류장 이름을 지정할 수 있는 줄(위 `row`는 칸이 null 고정이라 따로 만든다). */
  const at = (key: string, runStopId: string | null, stopName: string, atTime: string | null = "13:46"): RideRow => ({
    ...row(key, null),
    runStopId,
    stopName,
    atTime,
  });

  it("연속된 같은 칸을 한 묶음으로", () => {
    const groups = groupRowsByStop([
      at("a", "s1", "센트럴자이"),
      at("b", "s1", "센트럴자이"),
      at("c", "s2", "힐스테이트"),
    ]);
    expect(groups.map((g) => g.stopName)).toEqual(["센트럴자이", "힐스테이트"]);
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[1]!.rows).toHaveLength(1);
  });

  it("🔴 노선 순서를 보존한다 — 이름으로 전역 묶기를 하지 않는다", () => {
    // 한 회차에 같은 정류장이 두 번 나오는 편성은 유니크 인덱스가 막지만, 떨어져 있는 줄을
    // 이름으로 끌어모으면 "다음 정류장"을 못 읽는다. 연속된 것만 묶는 게 규약이다.
    const groups = groupRowsByStop([
      at("a", "s1", "센트럴자이"),
      at("b", "s2", "힐스테이트"),
      at("c", "s1", "센트럴자이"),
    ]);
    expect(groups.map((g) => g.stopName)).toEqual(["센트럴자이", "힐스테이트", "센트럴자이"]);
  });

  it("칸이 없는 추가 탑승은 이름으로 묶인다 — 바로 앞 같은 정류장에 합쳐진다", () => {
    // 예정에 없던 기록은 runStopId가 null이다(roster.mergePlanAndLog). 같은 자리에서 탄 사람이므로
    // 앞 묶음에 붙는 게 맞다.
    const groups = groupRowsByStop([at("a", null, "센트럴자이"), at("b", null, "센트럴자이")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it("빈 목록은 빈 묶음", () => {
    expect(groupRowsByStop([])).toEqual([]);
  });

  it("묶음의 시각·이름은 첫 줄에서 온다", () => {
    const groups = groupRowsByStop([at("a", "s1", "센트럴자이", "14:00")]);
    expect(groups[0]!.atTime).toBe("14:00");
    expect(groups[0]!.key).toBe("s1");
  });
});

describe("stopGroupRemaining — 묶음 머리의 '남음'", () => {
  it("아직 안 찍은 사람만 센다", () => {
    expect(stopGroupRemaining({ rows: [row("a", "boarded"), row("b", null), row("c", null)] })).toBe(2);
  });

  it("오늘 안 타는 줄은 세지 않는다", () => {
    // countProgress와 같은 규약 — 회색 줄은 화면에 남지만 '할 일'이 아니다.
    expect(stopGroupRemaining({ rows: [row("a", null, "in", "skipped"), row("b", null)] })).toBe(1);
  });
});

describe("splitRowsByIo — 등·하원이 섞인 회차", () => {
  it("섞이면 두 칸으로 가르고 회차 성격 쪽을 먼저 둔다", () => {
    const rows = [row("a", null, "in"), row("b", null, "out"), row("c", "boarded", "in")];
    expect(splitRowsByIo(rows, "in").map((s) => [s.io, s.rows.map((r) => r.key)])).toEqual([
      ["in", ["a", "c"]],
      ["out", ["b"]],
    ]);
    expect(splitRowsByIo(rows, "out").map((s) => s.io)).toEqual(["out", "in"]);
  });
  it("한쪽뿐이면 칸 하나다", () => {
    expect(splitRowsByIo([row("a", null, "in")], "out").map((s) => s.io)).toEqual(["in"]);
    expect(splitRowsByIo([], "in")).toEqual([]);
  });
});
