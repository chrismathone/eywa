import { describe, expect, it } from "vitest";
import { applySplitsToSlotRoster } from "./split-roster";
import type { ClassSplitDay } from "@/features/class-splits/attendance";

const day = (o: Partial<ClassSplitDay>): ClassSplitDay => ({ incoming: [], outgoing: [], ...o });
const visit = { splitId: "s1", studentId: "kim", otherClassId: "B", startTime: "17:20", endTime: "18:20" };
const info = (id: string) => (id === "B" ? { name: "중1 개별", teacherName: "유형숙" } : { name: "중1 수학", teacherName: "이성우" });

describe("오늘 출결 — 수업 나누기", () => {
  it("원래 반의 겹치는 교시에서 빠진다", () => {
    const r = applySplitsToSlotRoster({
      expected: new Set(["kim", "lee"]),
      slotStart: "17:20",
      slotEnd: "18:20",
      day: day({ outgoing: [visit] }),
      hasSlotRecord: () => false,
      classInfo: info,
    });
    expect([...r.expected]).toEqual(["lee"]);
  });
  it("겹치지 않는 교시엔 그대로", () => {
    const r = applySplitsToSlotRoster({
      expected: new Set(["kim"]),
      slotStart: "16:20",
      slotEnd: "17:20",
      day: day({ outgoing: [visit] }),
      hasSlotRecord: () => false,
      classInfo: info,
    });
    expect(r.expected.has("kim")).toBe(true);
    expect(r.marks.size).toBe(0);
  });
  it("그 교시에 이미 기록이 있으면 감추지 않고 표식만", () => {
    const r = applySplitsToSlotRoster({
      expected: new Set(["kim"]),
      slotStart: "17:20",
      slotEnd: "18:20",
      day: day({ outgoing: [visit] }),
      hasSlotRecord: () => true,
      classInfo: info,
    });
    expect(r.expected.has("kim")).toBe(true);
    expect(r.marks.get("kim")).toEqual({ dir: "out", note: "17:20~18:20 → 유형숙(중1 개별)" });
  });
  it("받는 반의 겹치는 교시엔 더해진다", () => {
    const r = applySplitsToSlotRoster({
      expected: new Set(["park"]),
      slotStart: "17:20",
      slotEnd: "18:20",
      day: day({ incoming: [{ ...visit, otherClassId: "A" }] }),
      hasSlotRecord: () => false,
      classInfo: info,
    });
    expect(r.expected.has("kim")).toBe(true);
    expect(r.marks.get("kim")?.dir).toBe("in");
    expect(r.marks.get("kim")?.note).toBe("나눔 17:20~18:20 ← 이성우(중1 수학)");
  });
  it("교시 끝을 모르면 손대지 않는다(지우는 쪽으로 실패하지 않게)", () => {
    const r = applySplitsToSlotRoster({
      expected: new Set(["kim"]),
      slotStart: "17:20",
      slotEnd: null,
      day: day({ outgoing: [visit], incoming: [{ ...visit, studentId: "choi" }] }),
      hasSlotRecord: () => false,
      classInfo: info,
    });
    expect([...r.expected]).toEqual(["kim"]);
  });
});
