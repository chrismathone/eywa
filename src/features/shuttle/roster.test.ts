import { describe, it, expect } from "vitest";
import {
  compactWeekdays,
  dayCodeOf,
  mergePlanAndLog,
  missedSignals,
  plannedRidesOn,
  ridesOn,
  type RideException,
} from "./roster";
import type { DayCode, ShuttleRun } from "./types";

const rider = (
  studentId: string,
  weekdays: DayCode[],
  ioKind: "in" | "out" = "in",
) => ({
  id: `r-${studentId}`,
  studentId,
  studentName: studentId,
  schoolGrade: "",
  ioKind,
  weekdays,
  memo: null,
  studentStatus: "enrolled",
});

describe("dayCodeOf — 날짜 → 요일 코드", () => {
  // 2026-08-19는 수요일(실제 달력). UTC 파싱이라 서버 TZ와 무관.
  it("실제 요일과 일치한다", () => {
    expect(dayCodeOf("2026-08-19")).toBe("wed");
    expect(dayCodeOf("2026-08-20")).toBe("thu");
    expect(dayCodeOf("2026-08-22")).toBe("sat");
    expect(dayCodeOf("2026-08-23")).toBe("sun");
  });
});

describe("compactWeekdays — makeedu식 압축 표기", () => {
  it("월~일 고정 순서로 붙인다(입력 순서 무관)", () => {
    expect(compactWeekdays(["thu", "mon", "wed"])).toBe("월수목");
    expect(compactWeekdays(["wed", "mon", "thu"])).toBe("월수목");
  });
  it("7일 전부는 '매일', 월~금 전부는 '평일'", () => {
    expect(compactWeekdays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe("매일");
    expect(compactWeekdays(["mon", "tue", "wed", "thu", "fri"])).toBe("평일");
  });
  it("평일 5일이라도 토요일이 섞이면 압축하지 않는다", () => {
    expect(compactWeekdays(["mon", "tue", "wed", "thu", "sat"])).toBe("월화수목토");
  });
  it("빈 배열은 빈 문자열", () => {
    expect(compactWeekdays([])).toBe("");
  });
});

describe("ridesOn — 요일 규칙", () => {
  it("배정 요일에만 탄다", () => {
    const r = rider("s1", ["mon", "wed", "thu"]);
    expect(ridesOn(r, "2026-08-19")).toBe(true); // 수
    expect(ridesOn(r, "2026-08-18")).toBe(false); // 화
  });
});

const run: ShuttleRun = {
  id: "run1",
  vehicleId: "v1",
  season: "term",
  runNo: 3,
  direction: "in",
  label: null,
  stops: [
    {
      id: "rs2",
      kind: "stop",
      stopId: "st2",
      stopName: "빌리브루센트 앞",
      stopMemo: null,
      sortOrder: 2,
      atTime: "14:01",
      riders: [rider("s2", ["wed"]), rider("s3", ["mon"])],
    },
    {
      id: "rs1",
      kind: "stop",
      stopId: "st1",
      stopName: "서대구 센트럴자이",
      stopMemo: null,
      sortOrder: 1,
      atTime: "13:53",
      riders: [rider("s1", ["mon", "wed", "thu"])],
    },
  ],
};

describe("plannedRidesOn — 그날 예정 명단", () => {
  it("정류장 순서(sortOrder)대로 나오고 그날 안 타는 사람은 빠진다", () => {
    const rows = plannedRidesOn(run, "2026-08-19"); // 수
    expect(rows.map((r) => r.rider.studentId)).toEqual(["s1", "s2"]);
    expect(rows[0]!.stopName).toBe("서대구 센트럴자이");
  });
  it("아무도 안 타는 날은 빈 배열", () => {
    expect(plannedRidesOn(run, "2026-08-21")).toEqual([]); // 금
  });
});

describe("mergePlanAndLog — 예정 × 기록", () => {
  const planned = plannedRidesOn(run, "2026-08-19");
  const log = (over: Partial<Parameters<typeof mergePlanAndLog>[1][number]> = {}) => ({
    id: "log1",
    studentId: "s1",
    runId: "run1",
    ioKind: "in" as const,
    status: "boarded" as const,
    memo: null,
    ...over,
  });

  it("🔴 기록이 없으면 status=null이다 — 미탑승이 아니다", () => {
    const rows = mergePlanAndLog(planned, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === null)).toBe(true);
  });

  it("찍힌 기록이 예정에 붙는다", () => {
    const rows = mergePlanAndLog(planned, [log()]);
    expect(rows.find((r) => r.studentId === "s1")!.status).toBe("boarded");
    expect(rows.find((r) => r.studentId === "s1")!.logId).toBe("log1");
    expect(rows.find((r) => r.studentId === "s2")!.status).toBe(null);
  });

  it("🔑 대조 키는 회차 축이라 정류장을 옮겨도 그날 기록이 붙어 있다", () => {
    // 기록은 stop 정보를 갖지 않는다 — s1을 다른 정류장으로 옮긴 뒤에도 같은 회차면 붙어야 한다.
    const moved = plannedRidesOn(
      { ...run, stops: run.stops.map((s) => ({ ...s, id: `${s.id}-moved` })) },
      "2026-08-19",
    );
    const rows = mergePlanAndLog(moved, [log()]);
    expect(rows.find((r) => r.studentId === "s1")!.status).toBe("boarded");
    expect(rows).toHaveLength(2); // 떨어져 나온 '추가 탑승' 줄이 생기지 않는다
  });

  it("예정에 없는데 기록이 있으면 남긴다(추가 탑승 — 명단에서 사라지면 안 된다)", () => {
    const rows = mergePlanAndLog(planned, [
      log({ id: "log9", studentId: "zz", status: "extra", memo: "오늘만", stopLabel: "빽다방" }),
    ]);
    expect(rows).toHaveLength(3);
    const extra = rows.find((r) => r.studentId === "zz")!;
    expect(extra.status).toBe("extra");
    expect(extra.memo).toBe("오늘만");
    expect(extra.stopName).toBe("빽다방");
    expect(extra.runStopId).toBe(null);
  });

  it("회차가 지워진 옛 기록은 이 회차 줄로 새어들지 않는다", () => {
    const rows = mergePlanAndLog(planned, [log({ id: "old", studentId: "yy", runId: null })]);
    expect(rows).toHaveLength(2);
  });

  it("같은 학생이 승차·하차로 각각 있으면 서로 안 섞인다", () => {
    const both = [
      ...planned,
      { ...planned[0]!, rider: { ...planned[0]!.rider, ioKind: "out" as const } },
    ];
    const rows = mergePlanAndLog(both, [log({ ioKind: "out" })]);
    const s1 = rows.filter((r) => r.studentId === "s1");
    expect(s1).toHaveLength(2);
    expect(s1.find((r) => r.ioKind === "in")!.status).toBe(null);
    expect(s1.find((r) => r.ioKind === "out")!.status).toBe("boarded");
  });
});

describe("missedSignals — 출결 신호(신호만, 자동 쓰기 없음)", () => {
  it("미탑승만 뽑고 사람이 읽는 문구를 만든다", () => {
    const out = missedSignals([
      { studentId: "s1", status: "boarded", memo: null, vehicleLabel: "1호차", runNo: 3, ioKind: "in" },
      { studentId: "s2", status: "missed", memo: "병원", vehicleLabel: "1호차", runNo: 3, ioKind: "in" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ studentId: "s2", where: "1호차 3회차 등원", reason: "병원" });
  });

  it("한 학생이 여러 번 미탑승이어도 한 줄", () => {
    const out = missedSignals([
      { studentId: "s2", status: "missed", memo: null, vehicleLabel: "1호차", runNo: 3, ioKind: "in" },
      { studentId: "s2", status: "missed", memo: null, vehicleLabel: "1호차", runNo: 7, ioKind: "out" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("차량 라벨이 없어도 raw 코드를 노출하지 않는다", () => {
    const out = missedSignals([
      { studentId: "s2", status: "missed", memo: "  ", vehicleLabel: null, runNo: null, ioKind: "out" },
    ]);
    expect(out[0]!.where).toBe("하원");
    expect(out[0]!.reason).toBe(null);
  });
});

// ── 일회성 탑승 개입(0229a) ────────────────────────────────────────────────────────────
// 🔴 원장 2026-08-20: *"오늘 연락이 와서 갑자기 탄다던지, 안타던지 하는 일회성 셔틀 개입도 필요함."*
//    명단 = **요일 매칭 − skip + add**. 화면·인쇄·출결 신호가 같은 답을 봐야 하므로 여기서만 만든다.

const exc = (over: Partial<RideException> & { kind: RideException["kind"] }): RideException => ({
  id: `e-${over.studentId ?? "x"}-${over.kind}`,
  studentId: "s1",
  studentName: "학생",
  schoolGrade: "",
  studentStatus: "enrolled",
  ioKind: "in",
  runStopId: null,
  memo: null,
  ...over,
});

describe("plannedRidesOn — 일회성 예외 겹치기", () => {
  const WED = "2026-08-19";

  it("🔴 skip은 줄을 **지우지 않는다** — 회색으로 남길 수 있게 dayKind만 바뀐다", () => {
    const rows = plannedRidesOn(run, WED, [exc({ kind: "skip", studentId: "s1" })]);
    expect(rows.map((r) => r.rider.studentId)).toEqual(["s1", "s2"]); // 여전히 두 줄
    expect(rows[0]!.dayKind).toBe("skipped");
    expect(rows[1]!.dayKind).toBe("regular");
  });

  it("skip은 **그 방향만** 뺀다 — 등원만 빠지고 하원은 그대로", () => {
    const rows = plannedRidesOn(run, WED, [exc({ kind: "skip", studentId: "s1", ioKind: "out" })]);
    // s1의 배정은 승차(in)라 하차(out) skip에 걸리지 않는다.
    expect(rows[0]!.dayKind).toBe("regular");
  });

  it("사유는 선택이라 없을 수 있고, 있으면 줄에 실려 온다", () => {
    const rows = plannedRidesOn(run, WED, [
      exc({ kind: "skip", studentId: "s1", memo: "오늘 엄마가 데리러 옴" }),
    ]);
    expect(rows[0]!.exceptionMemo).toBe("오늘 엄마가 데리러 옴");
    expect(rows[0]!.exceptionId).toBe("e-s1-skip");
  });

  it("add는 그 정류장 자리에 오늘만 타는 줄을 만든다(이름은 예외가 들고 온다)", () => {
    const rows = plannedRidesOn(run, WED, [
      exc({ kind: "add", studentId: "s9", studentName: "김추가", runStopId: "rs2" }),
    ]);
    const added = rows.find((r) => r.rider.studentId === "s9")!;
    expect(added.dayKind).toBe("added");
    expect(added.rider.studentName).toBe("김추가");
    expect(added.runStopId).toBe("rs2");
    expect(added.stopName).toBe("빌리브루센트 앞");
  });

  it("🔴 add가 **이미 오늘 타는 사람**을 가리키면 줄을 두 번 만들지 않는다(시수·진행 2배 방지)", () => {
    const rows = plannedRidesOn(run, WED, [
      exc({ kind: "add", studentId: "s1", runStopId: "rs1" }),
    ]);
    expect(rows.filter((r) => r.rider.studentId === "s1")).toHaveLength(1);
    expect(rows[0]!.dayKind).toBe("regular");
  });

  it("skip + add를 같이 걸면 옛 자리는 회색으로 남고 새 자리에 줄이 생긴다(정류장 하루 변경)", () => {
    const rows = plannedRidesOn(run, WED, [
      exc({ kind: "skip", studentId: "s1" }),
      exc({ kind: "add", studentId: "s1", runStopId: "rs2" }),
    ]);
    const mine = rows.filter((r) => r.rider.studentId === "s1");
    expect(mine.map((r) => [r.stopName, r.dayKind])).toEqual([
      ["서대구 센트럴자이", "skipped"],
      ["빌리브루센트 앞", "added"],
    ]);
  });

  it("run_stop이 없는 add(=자리 미상)는 무시한다 — 어디서 탈지 모르면 기사가 못 태운다", () => {
    const rows = plannedRidesOn(run, WED, [exc({ kind: "add", studentId: "s9" })]);
    expect(rows.map((r) => r.rider.studentId)).toEqual(["s1", "s2"]);
  });

  it("예외를 안 넘기면 종전과 똑같다(0229a 미적용 배포에서도 화면이 산다)", () => {
    expect(plannedRidesOn(run, WED)).toEqual(plannedRidesOn(run, WED, []));
  });
});

describe("mergePlanAndLog — 예외 표식이 줄까지 실려 온다", () => {
  it("dayKind·사유·예외 id가 RideRow에 그대로 남는다", () => {
    const planned = plannedRidesOn(run, "2026-08-19", [
      exc({ kind: "skip", studentId: "s1", memo: "오늘 안 감" }),
    ]);
    const rows = mergePlanAndLog(planned, []);
    const s1 = rows.find((r) => r.studentId === "s1")!;
    expect(s1.dayKind).toBe("skipped");
    expect(s1.exceptionMemo).toBe("오늘 안 감");
    expect(s1.exceptionId).toBe("e-s1-skip");
  });

  it("예정에 없던 기록(회차 축 leftover)은 예외로 생긴 줄이 아니다", () => {
    const rows = mergePlanAndLog(
      [],
      [{ id: "l1", studentId: "sX", runId: "run1", ioKind: "in", status: "extra", memo: null }],
    );
    expect(rows[0]!.dayKind).toBe("regular");
    expect(rows[0]!.exceptionId).toBeNull();
  });
});

describe("mergePlanAndLog — 한 회차 안에서 skip + add(정류장 하루 변경)", () => {
  const WED = "2026-08-19";
  // s1은 평소 rs1(서대구 센트럴자이)에서 탄다. 오늘만 rs2(빌리브루센트 앞)에서 탄다고 연락이 왔다.
  const planned = () =>
    plannedRidesOn(run, WED, [
      exc({ kind: "skip", studentId: "s1" }),
      exc({ kind: "add", studentId: "s1", runStopId: "rs2" }),
    ]);

  it("🔴 화면 key가 겹치지 않는다 — 대조 키를 그대로 쓰면 두 줄이 같은 key라 뒤섞인다", () => {
    const rows = mergePlanAndLog(planned(), []);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("🔴 기록은 **오늘 타는 줄**이 가져간다 — 회색 줄이 채가면 정작 태운 자리가 '미기록'이 된다", () => {
    const rows = mergePlanAndLog(planned(), [
      { id: "log1", studentId: "s1", runId: "run1", ioKind: "in", status: "boarded", memo: null },
    ]);
    const added = rows.find((r) => r.dayKind === "added")!;
    const skippedRow = rows.find((r) => r.dayKind === "skipped")!;
    expect(added.status).toBe("boarded");
    expect(added.logId).toBe("log1");
    expect(skippedRow.status).toBeNull();
  });

  it("줄 순서는 정류장 순서 그대로다(두 번 훑어도 자리가 안 바뀐다)", () => {
    const rows = mergePlanAndLog(planned(), []);
    expect(rows.map((r) => r.stopName)).toEqual([
      "서대구 센트럴자이", // rs1 (skip)
      "빌리브루센트 앞", // rs2 정기 s2
      "빌리브루센트 앞", // rs2 add s1
    ]);
  });
});
