import { describe, expect, it } from "vitest";
import { expandPlans, groupCellLessons } from "./plan-expand";

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

describe("expandPlans — 교재 배정은 그 배정을 끝 차수까지 넣는다(원장 2026-10-22)", () => {
  const sched = (dayOfWeek: string) => ({
    dayOfWeek, startTime: "18:20:00", endTime: "19:20:00", validFrom: null, validTo: null, slotTeacherLabel: "Charlie", slotRoomLabel: "304",
  });
  const base = {
    books: new Map([["b1", { title: "Grammar 1", pageTime: null, skillArea: "grammar", sessionCount: 12 }]]),
    lessonsByBook: new Map(),
    schedules: [sched("mon"), sched("wed")],
    holidays: {},
    shifts: null,
  };
  const plan = { id: "p1", textbook_id: "b1", slot_axis: "class", pace: "period", term_mode: "regular", start_date: "2026-10-19", start_lesson_no: 1 };

  it("🔴 10/19에 시작한 12차수 교재(월·수)는 10월에서 안 끊기고 11월 끝 차수까지", () => {
    const byCell = expandPlans({ ...base, plans: [plan], from: "2026-10-19", to: "2027-12-31" });
    const lines = Object.values(byCell).flat();
    expect(lines.map((l) => l.lessonNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(lines.find((l) => l.lessonNo === 12)!.date > "2026-10-31").toBe(true);
  });

  it("앞쪽은 from에서 자른다 — 지난 날짜엔 안 넣는다", () => {
    const byCell = expandPlans({ ...base, plans: [plan], from: "2026-10-26", to: "2027-12-31" });
    expect(Object.keys(byCell).every((k) => k >= "2026-10-26")).toBe(true);
  });
});
