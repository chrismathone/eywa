import { describe, expect, it } from "vitest";
import type { ClassSplit } from "@/features/class-splits/rules";
import { splitDateMarks } from "./split-marks";

const split: ClassSplit = {
  id: "s1",
  studentId: "stu",
  sourceClassId: "A",
  targetClassId: "B",
  dayOfWeek: "tue",
  startTime: "17:20",
  endTime: "18:20",
  validFrom: "2026-10-06",
  validTo: "2026-10-13",
  periodKind: "month",
  note: null,
};
const names = new Map([
  ["A", { name: "중1 수학", teacherName: "이성우" }],
  ["B", { name: "중1 개별", teacherName: "유형숙" }],
]);
// 10/6(화) · 10/9(금) · 10/13(화) · 10/20(화, 기간 밖)
const dates = ["2026-10-06", "2026-10-09", "2026-10-13", "2026-10-20"];

describe("월별 출석부 나눔 칸", () => {
  it("받는 반 — 기간 안 그 요일에만 서고, 명단에 세울 학생으로 나온다", () => {
    const r = splitDateMarks("B", dates, [split], names);
    expect(Object.keys(r.marks.stu ?? {})).toEqual(["2026-10-06", "2026-10-13"]);
    expect(r.marks.stu?.["2026-10-06"]).toEqual({ dir: "in", note: "나눔 17:20~18:20 ← 이성우(중1 수학)" });
    expect(r.incomingIds).toEqual(["stu"]);
  });
  it("원래 반 — 표식만(명단에 새로 세울 학생은 없다)", () => {
    const r = splitDateMarks("A", dates, [split], names);
    expect(r.marks.stu?.["2026-10-13"]).toEqual({ dir: "out", note: "17:20~18:20 → 유형숙(중1 개별)" });
    expect(r.incomingIds).toEqual([]);
  });
  it("상관없는 반·나눔 없음 = 빈 결과", () => {
    expect(splitDateMarks("C", dates, [split], names)).toEqual({ marks: {}, incomingIds: [] });
    expect(splitDateMarks("B", dates, [], names)).toEqual({ marks: {}, incomingIds: [] });
  });
  it("반 이름을 모르면 id를 내보내지 않는다", () => {
    const r = splitDateMarks("B", dates, [split], new Map());
    expect(r.marks.stu?.["2026-10-06"]?.note).toBe("나눔 17:20~18:20 ← 다른 반");
  });
});
