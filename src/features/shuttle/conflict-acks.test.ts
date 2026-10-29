import { describe, expect, it } from "vitest";
import { ACK_LIMIT, conflictKey, mergeAcks, parseAcks } from "./conflict-acks";

describe("conflict-acks — 수정된 내용 확인 기록", () => {
  it("열쇠 = 학생|수업(보강)|배차 카드", () => {
    expect(conflictKey({ studentId: "s", classId: "makeup:c|2026-10-30|18:00|19:50", runCardId: "run:o:fri" })).toBe("s|makeup:c|2026-10-30|18:00|19:50|run:o:fri");
  });
  it("깨진 값은 버린다", () => {
    expect(parseAcks(null)).toEqual([]);
    expect(parseAcks(["a", 3, "", "b"])).toEqual(["a", "b"]);
  });
  it("합치면 중복 없이 최근 것이 뒤로, 상한까지만", () => {
    expect(mergeAcks(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: ACK_LIMIT + 5 }, (_, i) => `k${i}`);
    const merged = mergeAcks(many, ["new"]);
    expect(merged).toHaveLength(ACK_LIMIT);
    expect(merged.at(-1)).toBe("new");
  });
});
