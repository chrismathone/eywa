import { describe, expect, it } from "vitest";
import type { ClassSplit } from "@/features/class-splits/rules";
import type { RosterEntry, WeekGrid } from "./grid";
import { applySplitsToGrid, incomingStudentIds } from "./split-roster";
import { applySplitsToCard, splitIncomingIds } from "./split-card";

// 2026-10-06 = 화요일
const DATE = "2026-10-06";
const split = (o: Partial<ClassSplit> = {}): ClassSplit => ({
  id: "s1",
  studentId: "kim",
  sourceClassId: "A",
  targetClassId: "B",
  dayOfWeek: "tue",
  startTime: "17:20",
  endTime: "18:20",
  validFrom: "2026-10-01",
  validTo: null,
  periodKind: "forever",
  note: null,
  ...o,
});
const names = new Map([
  ["A", { name: "중1 영어", teacherName: "이성우" }],
  ["B", { name: "중1 개별", teacherName: "유형숙" }],
]);
const entry = (studentId: string): RosterEntry => ({ studentId, eligible: true, isMakeup: false, historical: false });
const grid = (slots: [string, string][], roster: string[]): WeekGrid => ({
  weekMonday: "2026-10-05",
  days: [
    {
      date: DATE,
      dow: "tue",
      holiday: null,
      slots: slots.map(([s, e]) => ({
        slotStart: s,
        slotEnd: e,
        scheduled: true,
        teacherId: null,
        teacherLabel: null,
        roomLabel: null,
        lines: [],
        roster: roster.map(entry),
      })),
    },
  ],
  attendanceOnly: [],
  hiddenSpecial: [],
  strayRecords: [],
});
const rosterAt = (g: WeekGrid, i: number) => g.days[0]!.slots[i]!.roster;

describe("ECS 시트 — 교시 단위 나눔", () => {
  const slots: [string, string][] = [["16:20", "17:20"], ["17:20", "18:20"], ["18:20", "19:20"]];

  it("원래 반: 겹치는 교시에서만 빠진다", () => {
    const g = applySplitsToGrid(grid(slots, ["kim", "lee"]), "A", [split()], names, () => false);
    expect(rosterAt(g, 0).map((e) => e.studentId)).toEqual(["kim", "lee"]);
    expect(rosterAt(g, 1).map((e) => e.studentId)).toEqual(["lee"]);
    expect(rosterAt(g, 2).map((e) => e.studentId)).toEqual(["kim", "lee"]);
  });

  it("원래 반: 그 교시에 기록이 있으면 지우지 않고 표식만", () => {
    const g = applySplitsToGrid(grid(slots, ["kim"]), "A", [split()], names, (s, d, t) => s === "kim" && d === DATE && t === "17:20");
    const kim = rosterAt(g, 1).find((e) => e.studentId === "kim");
    expect(kim?.split).toEqual({ dir: "out", note: "17:20~18:20 → 유형숙(중1 개별)" });
  });

  it("받는 반: 겹치는 교시에 입력 가능한 행으로 선다", () => {
    const g = applySplitsToGrid(grid([["17:20", "18:20"], ["18:20", "19:20"]], ["park"]), "B", [split()], names, () => false);
    const kim = rosterAt(g, 0).find((e) => e.studentId === "kim");
    expect(kim).toMatchObject({ eligible: true, isMakeup: false, historical: false });
    expect(kim?.split?.note).toBe("나눔 17:20~18:20 ← 이성우(중1 영어)");
    expect(rosterAt(g, 1).some((e) => e.studentId === "kim")).toBe(false);
    expect(incomingStudentIds(g)).toEqual(["kim"]);
  });

  it("다른 요일·기간 밖이면 그대로", () => {
    const base = grid(slots, ["kim"]);
    expect(applySplitsToGrid(base, "A", [split({ dayOfWeek: "fri" })], names, () => false)).toEqual(base);
    expect(applySplitsToGrid(base, "A", [split({ validTo: "2026-10-05" })], names, () => false)).toEqual(base);
  });
});

type Row = { studentId: string; name: string; split?: { dir: "in" | "out"; note: string } };

describe("ECS 오늘 카드 — 반 단위 한 줄", () => {
  const base = (students: Row[], slots: { start: string; end: string | null }[], classId: string, hasRecord = false) =>
    applySplitsToCard<Row>({
      classId,
      date: DATE,
      slots,
      students,
      splits: [split()],
      names,
      hasRecord: () => hasRecord,
      makeRow: (sid) => ({ studentId: sid, name: "김민수" }),
    });

  it("원래 반 일부 교시만 덮으면 남기고 표식", () => {
    const out = base([{ studentId: "kim", name: "김민수" }], [{ start: "16:20", end: "17:20" }, { start: "17:20", end: "18:20" }], "A");
    expect(out[0]?.split?.dir).toBe("out");
  });
  it("원래 반 모든 교시를 덮고 기록이 없으면 뺀다", () => {
    expect(base([{ studentId: "kim", name: "김민수" }], [{ start: "17:20", end: "18:20" }], "A")).toEqual([]);
    expect(base([{ studentId: "kim", name: "김민수" }], [{ start: "17:20", end: "18:20" }], "A", true)).toHaveLength(1);
  });
  it("받는 반은 행을 더한다(겹칠 때만)", () => {
    expect(base([], [{ start: "17:20", end: "18:20" }], "B")[0]).toMatchObject({ studentId: "kim", split: { dir: "in" } });
    expect(base([], [{ start: "19:20", end: "20:20" }], "B")).toEqual([]);
    expect(splitIncomingIds(["A", "B"], DATE, [split()])).toEqual(["kim"]);
  });
});
