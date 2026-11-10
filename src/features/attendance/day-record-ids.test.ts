import { describe, expect, it } from "vitest";
import { dayRecordIdsByStudent } from "./day-record-ids";

describe("일별 폼 유효 기록 id — (학생·교시)별 최신 1건", () => {
  it("옛 정정본은 빼고 교시가 여럿이면 전부 싣는다", () => {
    const m = dayRecordIdsByStudent([
      { id: "a3", student_id: "s1", slot_start: "16:00:00" },
      { id: "a2", student_id: "s1", slot_start: "16:00:00" }, // 같은 교시의 옛 정정본
      { id: "a1", student_id: "s1", slot_start: "17:00:00" },
      { id: "b1", student_id: "s2", slot_start: null },
      { id: "b0", student_id: "s2", slot_start: null },
    ]);
    expect(m.get("s1")).toEqual(["a3", "a1"]);
    expect(m.get("s2")).toEqual(["b1"]);
    expect(m.has("s3")).toBe(false);
  });
});
