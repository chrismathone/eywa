import { describe, expect, it } from "vitest";
import type { DayCode, ShuttleRider, ShuttleRun, ShuttleRunStop } from "./types";
import { buildRunWeek, ridesOnDay, visibleRows, weekColumns } from "./week-grid";

const rider = (id: string, name: string, weekdays: DayCode[], o: Partial<ShuttleRider> = {}): ShuttleRider => ({
  id,
  studentId: `s-${id}`,
  studentName: name,
  schoolGrade: "중1",
  ioKind: "out",
  weekdays,
  memo: null,
  studentStatus: "enrolled",
  ...o,
});
const stop = (id: string, sortOrder: number, name: string, riders: ShuttleRider[], o: Partial<ShuttleRunStop> = {}): ShuttleRunStop => ({
  id,
  kind: "stop",
  stopId: id,
  stopName: name,
  stopMemo: null,
  sortOrder,
  atTime: null,
  riders,
  ...o,
});
const run = (stops: ShuttleRunStop[], o: Partial<ShuttleRun> = {}): ShuttleRun => ({
  id: "r1",
  vehicleId: "v2",
  season: "term",
  runNo: 1,
  direction: "out",
  label: "8시 하원",
  stops,
  ...o,
});
const active = (s: string) => s === "enrolled";

describe("셔틀 주간 시간표 격자 — 시트 '7,8시하원' 모양", () => {
  it("빈 요일 배열 = 매일", () => {
    expect(ridesOnDay({ weekdays: [] }, "wed")).toBe(true);
    expect(ridesOnDay({ weekdays: ["mon"] }, "wed")).toBe(false);
  });

  it("열 = 평일 다섯 + 배정이 있는 주말만", () => {
    expect(weekColumns([run([stop("a", 1, "북구청역", [rider("1", "김덕현", ["tue"])])])])).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(weekColumns([run([stop("a", 1, "북구청역", [rider("1", "김덕현", ["sat"])])])])).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
  });

  it("줄 = 정류장(노선 순서), 칸 = 그 요일 타는 학생, 맨 아래 = 요일별 서로 다른 학생 수", () => {
    const days: DayCode[] = ["mon", "tue", "wed", "thu", "fri"];
    const w = buildRunWeek(
      run([
        stop("b", 2, "서대구 센트럴 자이", [rider("2", "유채원", ["tue", "fri"])]),
        stop("a", 1, "북구청역 에듀포레", [rider("1", "김덕현", ["tue", "wed", "thu", "fri"])], { atTime: "20:15:00" }),
        stop("c", 3, "학원 도착", [], { kind: "arrive" }),
      ]),
      days,
      active,
    );
    expect(w.rows.map((r) => [r.name, r.time])).toEqual([
      ["북구청역 에듀포레", "20:15"],
      ["서대구 센트럴 자이", null],
      ["학원 도착", null],
    ]);
    expect(w.rows[0]!.cells.tue.map((r) => r.name)).toEqual(["김덕현"]);
    expect(w.rows[0]!.cells.mon).toEqual([]);
    expect(w.counts).toEqual({ mon: 0, tue: 2, wed: 1, thu: 1, fri: 2 });
    expect(w.total).toBe(2);
  });

  it("회차 방향과 반대로 타는 학생만 표식 · 재원 아님은 흐리게", () => {
    const w = buildRunWeek(
      run([
        stop("a", 1, "오페라 스위첸", [
          rider("1", "이서은", []),
          rider("2", "최하림", [], { ioKind: "in" }),
          rider("3", "천용준", [], { studentStatus: "withdrawn" }),
        ]),
      ]),
      ["mon"],
      active,
    );
    expect(w.rows[0]!.cells.mon.map((r) => [r.name, r.crossTag, r.inactive])).toEqual([
      ["이서은", null, false],
      ["천용준", null, true],
      ["최하림", "승차", false],
    ]);
  });

  it("같은 학생이 한 회차에 두 정류장(승차·하차)이어도 인원은 한 번", () => {
    const w = buildRunWeek(
      run([stop("a", 1, "A", [rider("1", "가", [])]), stop("b", 2, "B", [rider("2", "가", [], { studentId: "s-1", ioKind: "in" })])]),
      ["mon"],
      active,
    );
    expect(w.counts.mon).toBe(1);
  });
});

describe("화면용 줄 줄이기", () => {
  it("학생 없는 정류장 줄만 빼고, 출발·도착 줄은 남긴다", () => {
    const days: DayCode[] = ["mon", "tue"];
    const w = buildRunWeek(
      run([
        stop("d", 0, "학원 출발", [], { kind: "depart" }),
        stop("a", 1, "북구청역", [rider("1", "김덕현", ["tue"])]),
        stop("b", 2, "빈 정류장", []),
        stop("c", 3, "토요일만", [rider("2", "유채원", ["sat"])]),
      ]),
      days,
      active,
    );
    const v = visibleRows(w, days);
    expect(v.rows.map((r) => r.name)).toEqual(["학원 출발", "북구청역"]);
    expect(v.hidden).toBe(2);
  });
});
