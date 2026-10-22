import { describe, expect, it } from "vitest";
import { expandPlansThrough, groupCellLessons } from "./plan-expand";

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

describe("expandPlansThrough — 가져오기는 이 달에 걸린 배정을 끝 차수까지(원장 2026-10-22)", () => {
  const sched = (dayOfWeek: string) => ({
    dayOfWeek, startTime: "18:20:00", endTime: "19:20:00", validFrom: null, validTo: null, slotTeacherLabel: "Charlie", slotRoomLabel: "304",
  });
  const base = {
    books: new Map([
      ["b1", { title: "Grammar 1", pageTime: null, skillArea: "grammar", sessionCount: 12 }],
      ["b2", { title: "Reading 2", pageTime: null, skillArea: "reading", sessionCount: 4 }],
    ]),
    lessonsByBook: new Map(),
    schedules: [sched("mon"), sched("wed")],
    holidays: {},
    shifts: null,
    from: "2026-10-01",
    to: "2026-10-31",
    horizon: "2027-12-31",
  };
  const plan = (id: string, textbook_id: string, start_date: string) => ({
    id, textbook_id, slot_axis: "class", pace: "period", term_mode: "regular", start_date, start_lesson_no: 1,
  });

  it("🔴 10/19에 시작한 12차수 교재(월·수)는 10월에서 안 끊기고 11월 끝 차수까지", () => {
    const out = expandPlansThrough({ ...base, plans: [plan("p1", "b1", "2026-10-19")] });
    const lines = Object.values(out.byCell).flat();
    expect(lines.map((l) => l.lessonNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(out.lastDate > "2026-10-31").toBe(true);
    expect(lines.find((l) => l.lessonNo === 12)!.date).toBe(out.lastDate);
  });

  it("이 달 뒤에 시작하는 배정은 안 가져온다(그 달 화면 몫)", () => {
    const out = expandPlansThrough({ ...base, plans: [plan("p1", "b1", "2026-10-19"), plan("p2", "b2", "2026-11-02")] });
    expect(Object.values(out.byCell).flat().some((l) => l.title === "Reading 2")).toBe(false);
  });

  it("앞쪽은 from에서 자른다 — 지난 달 차수는 안 들어간다", () => {
    const out = expandPlansThrough({ ...base, plans: [plan("p1", "b1", "2026-09-14")] });
    expect(Object.keys(out.byCell).every((k) => k >= "2026-10-01")).toBe(true);
  });

  it("이 달에 걸린 배정이 없으면 비고 lastDate = to", () => {
    expect(expandPlansThrough({ ...base, plans: [plan("p2", "b2", "2026-11-02")] })).toEqual({ byCell: {}, lastDate: "2026-10-31" });
  });
});
