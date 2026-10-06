import { describe, expect, it } from "vitest";
import { incomingInSlot, outgoingStudentIdsInSlot, splitDayOf, splitRowNote, visitOverlapsSlot } from "./attendance";
import type { ClassSplit } from "./rules";

const s = (o: Partial<ClassSplit> = {}): ClassSplit => ({
  id: "s1",
  studentId: "stu",
  sourceClassId: "A",
  targetClassId: "B",
  dayOfWeek: "tue",
  startTime: "17:20",
  endTime: "18:20",
  validFrom: "2026-10-06",
  validTo: null,
  periodKind: "forever",
  note: null,
  ...o,
});
const TUE = "2026-10-13";

describe("출석부 규약 — 받는 반엔 미리 서고, 원래 반은 그 교시만 빠진다", () => {
  it("받는 반 = incoming · 원래 반 = outgoing", () => {
    expect(splitDayOf("B", TUE, [s()]).incoming.map((v) => v.studentId)).toEqual(["stu"]);
    expect(splitDayOf("A", TUE, [s()]).outgoing.map((v) => v.otherClassId)).toEqual(["B"]);
  });
  it("다른 요일·기간 밖이면 없다", () => {
    expect(splitDayOf("B", "2026-10-16", [s()]).incoming).toEqual([]);
    expect(splitDayOf("B", TUE, [s({ validTo: "2026-10-07" })]).incoming).toEqual([]);
  });
  it("교시 단위 — 겹치는 교시에서만 빠지고 온다", () => {
    const a = splitDayOf("A", TUE, [s()]);
    expect([...outgoingStudentIdsInSlot(a, "16:20", "17:20")]).toEqual([]);
    expect([...outgoingStudentIdsInSlot(a, "17:20", "18:20")]).toEqual(["stu"]);
    const b = splitDayOf("B", TUE, [s()]);
    expect(incomingInSlot(b, "18:20", "19:20")).toEqual([]);
    expect(incomingInSlot(b, "17:20", "18:20")).toHaveLength(1);
  });
  it("교시 시각을 모르면 빼지 않는다(지우는 쪽으로 실패하지 않게)", () => {
    expect(visitOverlapsSlot(s(), null, null)).toBe(false);
  });
  it("표식 문장 — raw id 대신 선생님(반)", () => {
    const [v] = splitDayOf("A", TUE, [s()]).outgoing;
    expect(splitRowNote("out", v!, { name: "중1 개별", teacherName: "유형숙" })).toBe("17:20~18:20 → 유형숙(중1 개별)");
    expect(splitRowNote("in", v!, undefined)).toBe("나눔 17:20~18:20 ← 다른 반");
  });
});
