import { describe, expect, it } from "vitest";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { planCellKeys } from "./lesson-schedule";
import { expandPlans, groupCellLessons, type BookInfo, type CellLessons, type LessonText, type PlanRow } from "./plan-expand";
import {
  composedOfLessons,
  isAssignedLine,
  placeShiftMarker,
  planRelay,
  type RelayBook,
  type RelayLine,
  type RelayOp,
} from "./lesson-relay";

// 중등E_중1 SKY(2026-10-16 제보) 모양 — 화 18:20 1·2차수 + 금 18:20 1차수, 2027-01-01(금)은 신정.
const row = (dayOfWeek: string): MonthScheduleRow => ({
  dayOfWeek,
  startTime: "18:20:00",
  endTime: "19:20:00",
  validFrom: null,
  validTo: null,
  slotTeacherLabel: "Charlie",
  slotRoomLabel: "304",
});
const SCHEDULES = [row("tue"), row("fri")];
const HOLIDAYS = { "2027-01-01": "신정" };
const PLAN: PlanRow = {
  textbook_id: "tb",
  slot_axis: "class",
  pace: "min25",
  term_mode: "regular",
  start_date: "2027-01-01",
  start_lesson_no: 1,
  slot_picks: ["fri|18:20|1", "tue|18:20|1", "tue|18:20|2"],
};
const BOOKS = new Map<string, BookInfo>([["tb", { title: "Grammar", pageTime: null, skillArea: "grammar", sessionCount: 20 }]]);
const LESSONS = new Map<string, Map<number, LessonText>>([
  ["tb", new Map(Array.from({ length: 20 }, (_, i) => [i + 1, { progress: `Unit ${i + 1}`, homework: null }]))],
]);
const BOOK: RelayBook = {
  skillArea: "grammar",
  title: "Grammar",
  progressTexts: new Set(Array.from({ length: 20 }, (_, i) => `Unit ${i + 1}`)),
  homeworkTexts: new Set(),
};
const SLOT = "18:20";
const END = "2027-01-29";
const WIDE = "2027-03-31";

/** 일정 — 가져오기는 END까지만(그 뒤는 아직 안 가져온 칸), 다시 깔기 계산은 넉넉히(서버와 같게). */
const scheduleOf = (shifts: Record<string, "skip" | "advance">, to: string = END) =>
  groupCellLessons(
    Object.values(
      expandPlans({
        plans: [PLAN],
        books: BOOKS,
        lessonsByBook: LESSONS,
        schedules: SCHEDULES,
        holidays: HOLIDAYS,
        shifts,
        from: "2027-01-01",
        to,
      }),
    ).flat(),
  );

/** 실제 칸 — id → 줄. 가져오기(차수 하나 = 줄 하나, 이미 있는 k번째 줄은 그대로)를 흉내 낸다. */
type Db = Map<string, RelayLine>;
let seq = 0;
function importInto(db: Db, cells: readonly CellLessons[]) {
  for (const c of cells) {
    const have = [...db.values()]
      .filter((l) => l.date === c.date && l.slot === c.slot && l.textbook === "Grammar")
      .sort((a, b) => a.lineNo - b.lineNo);
    const maxNo = Math.max(0, ...[...db.values()].filter((l) => l.date === c.date && l.slot === c.slot).map((l) => l.lineNo));
    c.lessons.forEach((lesson, i) => {
      if (have[i]) return; // 그 차수 자리의 줄이 이미 있다 — 빈 칸만 채운다(여기선 다 차 있다).
      const id = `r${(seq += 1)}`;
      db.set(id, { id, date: c.date, slot: c.slot, skillArea: "grammar", lineNo: maxNo + i + 1, textbook: "Grammar", progress: lesson.progress, homework: lesson.homework });
    });
  }
}
function apply(db: Db, ops: RelayOp[]) {
  const inserts: CellLessons[] = [];
  for (const o of ops) {
    if (o.op === "update") db.set(o.id, { ...db.get(o.id)!, progress: o.progress, homework: o.homework });
    else if (o.op === "delete") db.delete(o.id);
    else inserts.push({ date: o.date, slot: o.slot, lessons: o.lessons });
  }
  importInto(db, inserts);
}
/** 날짜 → 그 칸 줄들의 진도(줄 번호 순, 보기 좋게 ` / `로 — 저장은 줄마다 따로다). */
const view = (db: Db) => {
  const byDate = new Map<string, RelayLine[]>();
  for (const l of db.values()) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  return Object.fromEntries(
    [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, ls]) => [d.slice(5), ls.sort((a, b) => a.lineNo - b.lineNo).map((l) => l.progress).join(" / ")]),
  );
};
/** 날짜 → 줄 수. */
const lineCount = (db: Db, date: string) => [...db.values()].filter((l) => l.date === date).length;

/** 서버가 하는 일 그대로: 표식 → 새 일정 → 다시 깔기. */
function press(db: Db, shifts: Record<string, "skip" | "advance">, date: string, kind: "skip" | "advance") {
  const pressedKey = `${date}|${SLOT}`;
  const cells = planCellKeys({ startDate: "2027-01-01", schedules: SCHEDULES, holidays: HOLIDAYS, axis: "class", slotPicks: PLAN.slot_picks as string[], lookaheadDays: 60 });
  expect(cells).toContain(pressedKey);
  const previous = scheduleOf({ ...shifts }, WIDE);
  const mark = placeShiftMarker({ kind, pressedKey, sequence: cells.filter((k) => k >= pressedKey), shifts });
  if (!mark) throw new Error("no marker cell");
  if (mark.op === "delete") delete shifts[mark.key];
  else shifts[mark.key] = kind;
  const mine = [...db.values()].filter((l) => isAssignedLine(l, BOOK));
  const edited = [...db.values()].filter((l) => !isAssignedLine(l, BOOK));
  apply(db, planRelay({ kind, date, slot: SLOT, lines: mine, edited, targets: scheduleOf(shifts, WIDE), previous }).ops);
}

function freshDb(): Db {
  const db: Db = new Map();
  importInto(db, scheduleOf({}));
  return db;
}

const ORIGINAL = {
  "01-05": "Unit 1 / Unit 2",
  "01-08": "Unit 3",
  "01-12": "Unit 4 / Unit 5",
  "01-15": "Unit 6",
  "01-19": "Unit 7 / Unit 8",
  "01-22": "Unit 9",
  "01-26": "Unit 10 / Unit 11",
  "01-29": "Unit 12",
};

describe("배정 교재 미루기·당기기 — 화 1·2차수 + 금 1차수(중등E_중1 SKY)", () => {
  it("가져온 상태 = 화·금을 번갈아 차수 순서대로(신정 건너뜀)", () => {
    expect(view(freshDb())).toEqual(ORIGINAL);
  });

  it("🔴 한 교시 1·2차수 = 줄 두 개(원장 2026-10-19 — 차시마다 한 줄)", () => {
    const db = freshDb();
    expect(lineCount(db, "2027-01-05")).toBe(2);
    expect(lineCount(db, "2027-01-08")).toBe(1);
  });

  it("🔴 1/5 미룸 — 누른 칸은 비고(원장 2026-10-19), 뒤는 **교재 순서로** 한 칸씩(금요일도 함께)", () => {
    const db = freshDb();
    press(db, {}, "2027-01-05", "skip");
    expect(view(db)).toEqual({
      "01-08": "Unit 1",
      "01-12": "Unit 2 / Unit 3",
      "01-15": "Unit 4",
      "01-19": "Unit 5 / Unit 6",
      "01-22": "Unit 7",
      "01-26": "Unit 8 / Unit 9",
      "01-29": "Unit 10",
      "02-02": "Unit 11 / Unit 12", // 범위 밖으로 밀린 차수는 다음 칸에 — 가져와 둔 차수가 하나도 안 사라진다
    });
  });

  it("🔴 미룸 뒤 당김 = 원래대로(표식이 지워지고 칸이 일정대로 돌아온다)", () => {
    const db = freshDb();
    const shifts: Record<string, "skip" | "advance"> = {};
    press(db, shifts, "2027-01-05", "skip");
    press(db, shifts, "2027-01-05", "advance");
    expect(shifts).toEqual({});
    // 가져와 둔 칸은 전부 원래대로. 미룸이 다음 칸(2/2)까지 썼으므로 당김은 그 칸을 일정대로 채운다
    // (당김의 끝 칸 = 다음 차수 — 종전 당김 그대로). 정확히 누르기 전으로는 [되돌리기](shift-undo.ts).
    const { "02-02": tail, ...rest } = view(db);
    expect(rest).toEqual(ORIGINAL);
    expect(tail).toBe("Unit 13 / Unit 14");
    expect(lineCount(db, "2027-01-05")).toBe(2);
  });

  it("🔑 옛 `A / B` 한 줄도 다시 깔리면 차수마다 한 줄로 나뉜다", () => {
    const db: Db = new Map();
    db.set("old", { id: "old", date: "2027-01-05", slot: SLOT, skillArea: "grammar", lineNo: 1, textbook: "Grammar", progress: "Unit 1 / Unit 2", homework: null });
    db.set("fri", { id: "fri", date: "2027-01-08", slot: SLOT, skillArea: "grammar", lineNo: 1, textbook: "Grammar", progress: "Unit 3", homework: null });
    const shifts: Record<string, "skip" | "advance"> = {};
    press(db, shifts, "2027-01-05", "skip");
    press(db, shifts, "2027-01-05", "advance");
    expect(view(db)["01-05"]).toBe("Unit 1 / Unit 2");
    expect(lineCount(db, "2027-01-05")).toBe(2);
  });

  it("🔴 당김을 두 번 — 차수가 순서를 지키고, 버린 차수만 빠진다(지워져 사라지는 차수 없음)", () => {
    const db = freshDb();
    const shifts: Record<string, "skip" | "advance"> = {};
    press(db, shifts, "2027-01-05", "advance");
    press(db, shifts, "2027-01-05", "advance");
    // 두 번째 표식은 같은 칸이 아니라 그 교재의 다음 칸(1/8 금)에 쌓인다.
    expect(shifts).toEqual({ "2027-01-05|18:20": "advance", "2027-01-08|18:20": "advance" });
    const v = view(db);
    expect(v).toEqual({
      "01-05": "Unit 2 / Unit 3",
      "01-08": "Unit 5",
      "01-12": "Unit 6 / Unit 7",
      "01-15": "Unit 8",
      "01-19": "Unit 9 / Unit 10",
      "01-22": "Unit 11",
      "01-26": "Unit 12 / Unit 13",
      "01-29": "Unit 14",
    });
  });

  it("월간계획(일정)과 실제가 같은 차수를 말한다 — 미룸 후", () => {
    const db = freshDb();
    const shifts: Record<string, "skip" | "advance"> = {};
    press(db, shifts, "2027-01-12", "skip");
    for (const t of scheduleOf(shifts)) {
      if (t.date <= "2027-01-12") continue; // 누른 칸과 그 앞은 따로 본다
      expect(view(db)[t.date.slice(5)]).toBe(t.lessons.map((l) => l.progress).join(" / "));
    }
  });

  it("🔴 선생님이 고쳐 쓴 줄은 건드리지 않는다", () => {
    const db = freshDb();
    const edited = [...db.values()].find((l) => l.date === "2027-01-12")!;
    db.set(edited.id, { ...edited, progress: "Unit 4 복습" });
    press(db, {}, "2027-01-05", "skip");
    // 고쳐 쓴 1번 줄은 그대로, 2번 자리에 그 칸의 2번째 차수(Unit 3)가 온다 — 차수가 사라지거나 자리를 바꾸지 않는다.
    expect(view(db)["01-12"]).toBe("Unit 4 복습 / Unit 3");
    expect(view(db)["01-15"]).toBe("Unit 4");
  });

  it("누른 칸 앞의 줄은 안 바뀐다", () => {
    const db = freshDb();
    press(db, {}, "2027-01-15", "skip");
    const v = view(db);
    expect([v["01-05"], v["01-08"], v["01-12"]]).toEqual(["Unit 1 / Unit 2", "Unit 3", "Unit 4 / Unit 5"]);
    expect(v["01-15"]).toBeUndefined(); // 누른 칸은 비었다
    expect(v["01-19"]).toBe("Unit 6 / Unit 7");
  });

  it("🔴 마지막 줄이 있는 칸에서 미뤄도 그 차수는 다음 칸에 남는다(사라지지 않는다)", () => {
    const db = freshDb();
    press(db, {}, "2027-01-29", "skip");
    expect(view(db)["01-29"]).toBeUndefined();
    expect(view(db)["02-02"]).toBe("Unit 12 / Unit 13"); // 1/29의 Unit 12가 다음 칸(화 1·2차수)으로
  });

  it("🔴 미룸 = 누른 칸의 배정 줄을 지운다(해당 영역 날리기)", () => {
    const db = freshDb();
    press(db, {}, "2027-01-12", "skip");
    expect(lineCount(db, "2027-01-12")).toBe(0);
    expect(view(db)["01-15"]).toBe("Unit 4");
  });

  it("가져오기 전(실제 줄 없음)엔 아무것도 안 쓴다 — 표식만", () => {
    expect(planRelay({ kind: "skip", date: "2027-01-05", slot: SLOT, lines: [], targets: scheduleOf({}), previous: [] })).toEqual({ ops: [], end: null });
  });

  it("🔴 교재가 끝난 뒤 칸에 선생님이 복사해 둔 같은 문구 줄은 지우지 않는다(실데이터 2026-10-16: 브릿지 C 10/29)", () => {
    // 차수 문구가 모두 같은 교재(`10개`) — 내용만으론 배정 줄과 구분이 안 된다. 옛 일정이 놓지 않은 칸이면 남긴다.
    const line = (id: string, date: string): RelayLine => ({ id, date, slot: SLOT, skillArea: "grammar", lineNo: 1, textbook: "Grammar", progress: "Unit 1", homework: null });
    const r = planRelay({
      kind: "advance",
      date: "2027-01-05",
      slot: SLOT,
      lines: [line("a", "2027-01-05"), line("b", "2027-01-08"), line("extra", "2027-01-12")],
      targets: [{ date: "2027-01-05", slot: SLOT, lessons: [{ progress: "Unit 1", homework: null }] }],
      previous: [
        { date: "2027-01-05", slot: SLOT },
        { date: "2027-01-08", slot: SLOT },
      ],
    });
    expect(r.ops).toEqual([{ op: "delete", id: "b" }]); // 1/8은 옛 일정 칸이라 비우고, 1/12(교재 밖)는 그대로
  });
});

describe("composedOfLessons / isAssignedLine", () => {
  const known = new Set(["Unit 1", "Unit 2", "A / B"]);
  it("차수 문구 하나, 이은 값, 빈 값은 참", () => {
    expect(composedOfLessons("Unit 1", known)).toBe(true);
    expect(composedOfLessons("Unit 1 / Unit 2", known)).toBe(true);
    expect(composedOfLessons(" ", known)).toBe(true);
    expect(composedOfLessons(null, known)).toBe(true);
  });
  it("차수 문구 안에 `/`가 있어도 맞춘다", () => {
    expect(composedOfLessons("A / B / Unit 1", known)).toBe(true);
  });
  it("손으로 덧붙인 값은 거짓", () => {
    expect(composedOfLessons("Unit 1 복습", known)).toBe(false);
    expect(composedOfLessons("Unit 1 / 단어시험", known)).toBe(false);
    expect(composedOfLessons("Unit 12", known)).toBe(false);
  });
  it("구분·교재명이 다르면 배정 줄이 아니다", () => {
    const line: RelayLine = { id: "x", date: "2027-01-05", slot: SLOT, skillArea: "grammar", lineNo: 1, textbook: " grammar ", progress: "Unit 1", homework: null };
    expect(isAssignedLine(line, BOOK)).toBe(true);
    expect(isAssignedLine({ ...line, skillArea: "vocab" }, BOOK)).toBe(false);
    expect(isAssignedLine({ ...line, textbook: "Grammar 2" }, BOOK)).toBe(false);
  });
});

describe("placeShiftMarker", () => {
  const seq = ["2027-01-05|18:20", "2027-01-08|18:20", "2027-01-12|18:20"];
  it("반대 표식이 있으면 지운다", () => {
    expect(placeShiftMarker({ kind: "advance", pressedKey: seq[0]!, sequence: seq, shifts: { [seq[0]!]: "skip" } })).toEqual({ op: "delete", key: seq[0] });
  });
  it("같은 표식이 있으면 교재의 다음 칸(요일이 달라도)", () => {
    expect(placeShiftMarker({ kind: "skip", pressedKey: seq[0]!, sequence: seq, shifts: { [seq[0]!]: "skip" } })).toEqual({ op: "set", key: seq[1] });
  });
  it("자리가 없으면 null", () => {
    const full = Object.fromEntries(seq.map((k) => [k, "skip" as const]));
    expect(placeShiftMarker({ kind: "skip", pressedKey: seq[0]!, sequence: seq, shifts: full })).toBeNull();
  });
});
