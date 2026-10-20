import { describe, expect, it } from "vitest";
import { groupCellLessons } from "./plan-expand";

describe("groupCellLessons — 한 교시에 같은 교재 차수 둘", () => {
  it("🔴 같은 칸의 1·2차수를 이어 붙이지 않고 차수마다 따로 둔다(원장 2026-10-19 — 차시마다 한 줄)", () => {
    const out = groupCellLessons([
      { date: "2026-10-20", slotStart: "17:20", lessonNo: 2, progress: "Unit 2", homework: "WB 3p" },
      { date: "2026-10-20", slotStart: "17:20", lessonNo: 1, progress: "Unit 1", homework: "WB 3p" },
      { date: "2026-10-23", slotStart: "17:20", lessonNo: 3, progress: "Unit 3", homework: null },
    ]);
    expect(out).toEqual([
      {
        date: "2026-10-20",
        slot: "17:20",
        lessons: [
          { progress: "Unit 1", homework: "WB 3p" },
          { progress: "Unit 2", homework: "WB 3p" },
        ],
      },
      { date: "2026-10-23", slot: "17:20", lessons: [{ progress: "Unit 3", homework: null }] },
    ]);
  });

  it("공백뿐인 값은 null", () => {
    const out = groupCellLessons([{ date: "2026-10-20", slotStart: "16:20", lessonNo: 1, progress: " ", homework: "단어" }]);
    expect(out[0]!.lessons).toEqual([{ progress: null, homework: "단어" }]);
  });

  it("날짜·교시 오름차순(RPC 락 순서 규약)", () => {
    const out = groupCellLessons([
      { date: "2026-10-21", slotStart: "16:20", lessonNo: 3, progress: "c", homework: null },
      { date: "2026-10-20", slotStart: "18:20", lessonNo: 2, progress: "b", homework: null },
      { date: "2026-10-20", slotStart: "16:20", lessonNo: 1, progress: "a", homework: null },
    ]);
    expect(out.map((o) => `${o.date} ${o.slot}`)).toEqual(["2026-10-20 16:20", "2026-10-20 18:20", "2026-10-21 16:20"]);
  });
});
