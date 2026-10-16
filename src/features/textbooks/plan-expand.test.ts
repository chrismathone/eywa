import { describe, expect, it } from "vitest";
import { mergeSameCellLessons } from "./plan-expand";

describe("mergeSameCellLessons — 한 교시에 같은 교재 차수 둘", () => {
  it("🔴 같은 칸의 1·2차수를 한 줄로 합친다(RPC가 둘째 줄을 건너뛰지 않게)", () => {
    const out = mergeSameCellLessons([
      { date: "2026-10-20", slotStart: "17:20", lessonNo: 2, progress: "Unit 2", homework: "WB 3p" },
      { date: "2026-10-20", slotStart: "17:20", lessonNo: 1, progress: "Unit 1", homework: "WB 3p" },
      { date: "2026-10-23", slotStart: "17:20", lessonNo: 3, progress: "Unit 3", homework: null },
    ]);
    expect(out).toEqual([
      { date: "2026-10-20", slot: "17:20", progress: "Unit 1 / Unit 2", homework: "WB 3p" },
      { date: "2026-10-23", slot: "17:20", progress: "Unit 3", homework: null },
    ]);
  });

  it("빈 진도는 이음표 없이 건너뛰고, 전부 비면 null", () => {
    const out = mergeSameCellLessons([
      { date: "2026-10-20", slotStart: "16:20", lessonNo: 1, progress: null, homework: null },
      { date: "2026-10-20", slotStart: "16:20", lessonNo: 2, progress: " ", homework: "단어" },
    ]);
    expect(out).toEqual([{ date: "2026-10-20", slot: "16:20", progress: null, homework: "단어" }]);
  });

  it("날짜·교시 오름차순(RPC 락 순서 규약)", () => {
    const out = mergeSameCellLessons([
      { date: "2026-10-21", slotStart: "16:20", lessonNo: 3, progress: "c", homework: null },
      { date: "2026-10-20", slotStart: "18:20", lessonNo: 2, progress: "b", homework: null },
      { date: "2026-10-20", slotStart: "16:20", lessonNo: 1, progress: "a", homework: null },
    ]);
    expect(out.map((o) => `${o.date} ${o.slot}`)).toEqual(["2026-10-20 16:20", "2026-10-20 18:20", "2026-10-21 16:20"]);
  });
});
