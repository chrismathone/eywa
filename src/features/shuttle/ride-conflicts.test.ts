import { describe, expect, it } from "vitest";
import { findRideConflicts } from "./ride-conflicts";
import type { RunCard } from "./run-cards";

const run = (p: Partial<RunCard>): RunCard => ({
  id: "run:out:fri",
  runId: "out",
  vehicleId: "v2",
  vehicleName: "2호차",
  runName: "2회차",
  direction: "out",
  day: "fri",
  start: "19:00",
  end: "19:30",
  academyTime: "19:00",
  riders: [{ id: "s1", name: "박도윤", schoolGrade: "대구일중1", stopName: "대구일중 앞", stopTime: "19:10" }],
  ...p,
});
const cls = (p: Partial<{ id: string; day: string; start: string; end: string; makeup: boolean }>) => ({
  id: "c",
  day: "fri",
  start: "16:00",
  end: "17:50",
  className: "중등 수학",
  students: [{ id: "s1", name: "박도윤" }],
  ...p,
});

describe("findRideConflicts — 수업 ↔ 배차 겹침", () => {
  it("🔑 보강이 하원 차에 타 있을 시간과 겹치면 잡는다", () => {
    const r = findRideConflicts([cls({ id: "mk", start: "18:00", end: "19:50", makeup: true })], [run({})]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ studentId: "s1", classId: "mk", runCardId: "run:out:fri" });
    expect(r[0]!.text).toBe("박도윤: 보강 중등 수학 18:00~19:50 ↔ 하원 2호차 2회차 19:00~19:10");
  });
  it("평소(수업 끝 → 차 출발)는 겹치지 않는다 · 끝이 맞닿는 것도 겹침 아님", () => {
    expect(findRideConflicts([cls({})], [run({})])).toEqual([]);
    expect(findRideConflicts([cls({ end: "19:00" })], [run({})])).toEqual([]);
  });
  it("등원: 정류장 시각 ~ 학원 도착 사이에 수업이 시작하면 잡는다 · 다른 요일·다른 학생은 무관", () => {
    const inbound = run({ id: "run:in:fri", direction: "in", start: "15:20", end: "15:40", academyTime: "15:40", riders: [{ id: "s1", name: "박도윤", schoolGrade: "", stopName: "정문", stopTime: "15:20" }] });
    expect(findRideConflicts([cls({ start: "15:30", end: "17:00" })], [inbound])).toHaveLength(1);
    expect(findRideConflicts([cls({ start: "15:30", end: "17:00", day: "thu" })], [inbound])).toEqual([]);
    expect(findRideConflicts([{ ...cls({ start: "15:30" }), students: [{ id: "s2", name: "남" }] }], [inbound])).toEqual([]);
  });
  it("시각을 모르면 판정하지 않는다", () => {
    expect(findRideConflicts([cls({ start: "18:00", end: "19:50" })], [run({ academyTime: null })])).toEqual([]);
  });
});
