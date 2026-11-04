import { describe, expect, it } from "vitest";
import type { RunCard } from "./run-cards";
import { dayRideChanges, groupByKind, type ConflictKind } from "./sheet-alerts";

const card = (id: string, day: RunCard["day"], riders: RunCard["riders"], direction: RunCard["direction"] = "out"): RunCard => ({
  id, runId: id, vehicleId: "v", vehicleName: "1호차", runName: "1회차", direction, day, start: null, end: null, academyTime: null, riders,
});
const rider = (id: string, name: string, change?: RunCard["riders"][number]["change"]) => ({ id, name, schoolGrade: "", stopName: "침산초", stopTime: "14:50", ...(change ? { change } : {}) });

describe("sheet-alerts — 알림 분류(사용자 2026-11-04)", () => {
  it("종류 순서대로 묶고 빈 묶음은 안 낸다", () => {
    const list: { kind: ConflictKind; n: number }[] = [{ kind: "late", n: 1 }, { kind: "makeup", n: 2 }, { kind: "late", n: 3 }];
    expect(groupByKind(list, ["makeup", "changed", "early", "late"]).map((g) => [g.kind, g.items.map((x) => x.n)])).toEqual([
      ["makeup", [2]],
      ["late", [1, 3]],
    ]);
  });
  it("그날만 변경 = 요일 → 이름 순 · 자리 옮긴 아이는 한 줄(바뀐 카드의 그날만 줄은 뺀다) · 표식 없는 아이는 없음", () => {
    const got = dayRideChanges([
      card("a", "wed", [rider("s1", "오민서", { kind: "moved", to: "2호차 1회차 · 대성초 15:00" }), rider("s9", "평소")]),
      card("b", "wed", [rider("s1", "오민서", { kind: "dayOnly" })]),
      card("c", "mon", [rider("s2", "강지호", { kind: "skip" })]),
      card("d", "tue", [rider("s3", "김민준", { kind: "dayOnly" })]),
    ]);
    expect(got.map((x) => [x.day, x.kind, x.text])).toEqual([
      ["mon", "skip", "강지호: 하원 1호차 1회차 · 침산초 14:50"],
      ["tue", "dayOnly", "김민준: 하원 1호차 1회차 · 침산초 14:50"],
      ["wed", "moved", "오민서: 하원 1호차 1회차 · 침산초 14:50 → 2호차 1회차 · 대성초 15:00"],
    ]);
  });
});
