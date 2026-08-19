import { describe, it, expect } from "vitest";
import {
  compactWeekdays,
  dayCodeOf,
  mergePlanAndLog,
  missedSignals,
  plannedRidesOn,
  ridesOn,
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
