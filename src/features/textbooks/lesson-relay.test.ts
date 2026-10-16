import { describe, expect, it } from "vitest";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { planCellKeys } from "./lesson-schedule";
import { expandPlans, mergeSameCellLessons, type BookInfo, type LessonText, type PlanRow } from "./plan-expand";
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

const scheduleOf = (shifts: Record<string, "skip" | "advance">) =>
  mergeSameCellLessons(
    Object.values(
      expandPlans({
        plans: [PLAN],
        books: BOOKS,
        lessonsByBook: LESSONS,
        schedules: SCHEDULES,
        holidays: HOLIDAYS,
        shifts,
        from: "2027-01-01",
        to: END,
      }),
    ).flat(),
  );

/** 실제 칸 — 날짜 → 줄들. 가져오기(빈 칸만)를 흉내 낸다. */
type Db = Map<string, RelayLine>;
let seq = 0;
function importInto(db: Db, targets: ReturnType<typeof scheduleOf>) {
  for (const t of targets) {
    const sameTitle = [...db.values()].some((l) => l.date === t.date && l.slot === t.slot && l.textbook === "Grammar");
    if (sameTitle) continue; // RPC: 같은 교재명 줄이 있으면 빈 칸만 채운다(여기선 다 차 있다).
    const id = `r${(seq += 1)}`;
    db.set(id, { id, date: t.date, slot: t.slot, skillArea: "grammar", lineNo: 1, textbook: "Grammar", progress: t.progress, homework: t.homework });
  }
}
function apply(db: Db, ops: RelayOp[]) {
  const inserts: ReturnType<typeof scheduleOf> = [];
  for (const o of ops) {
    if (o.op === "update") db.set(o.id, { ...db.get(o.id)!, progress: o.progress, homework: o.homework });
    else if (o.op === "delete") db.delete(o.id);
    else inserts.push({ date: o.date, slot: o.slot, progress: o.progress, homework: o.homework });
  }
  importInto(db, inserts);
}
const view = (db: Db) =>
  Object.fromEntries(
    [...db.values()].sort((a, b) => a.date.localeCompare(b.date)).map((l) => [l.date.slice(5), l.progress]),
  );

/** 서버가 하는 일 그대로: 표식 → 새 일정 → 다시 깔기. */
function press(db: Db, shifts: Record<string, "skip" | "advance">, date: string, kind: "skip" | "advance") {
  const pressedKey = `${date}|${SLOT}`;
  const cells = planCellKeys({ startDate: "2027-01-01", schedules: SCHEDULES, holidays: HOLIDAYS, axis: "class", slotPicks: PLAN.slot_picks as string[], lookaheadDays: 60 });
  expect(cells).toContain(pressedKey);
  const mark = placeShiftMarker({ kind, pressedKey, sequence: cells.filter((k) => k >= pressedKey), shifts });
  if (!mark) throw new Error("no marker cell");
  if (mark.op === "delete") delete shifts[mark.key];
  else shifts[mark.key] = kind;
  const mine = [...db.values()].filter((l) => isAssignedLine(l, BOOK));
  apply(db, planRelay({ kind, date, slot: SLOT, lines: mine, targets: scheduleOf(shifts) }).ops);
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

  it("🔴 1/5 미룸 — 누른 칸은 그대로, 뒤는 **교재 순서로** 한 칸씩(금요일도 함께)", () => {
    const db = freshDb();
    press(db, {}, "2027-01-05", "skip");
    expect(view(db)).toEqual({
      "01-05": "Unit 1 / Unit 2", // 누른 칸 = 복사(실제 한 수업으로 고쳐 적는 자리)
      "01-08": "Unit 1",
      "01-12": "Unit 2 / Unit 3",
      "01-15": "Unit 4",
      "01-19": "Unit 5 / Unit 6",
      "01-22": "Unit 7",
      "01-26": "Unit 8 / Unit 9",
      "01-29": "Unit 10",
    });
  });

  it("🔴 미룸 뒤 당김 = 원래대로(표식이 지워지고 칸이 일정대로 돌아온다)", () => {
    const db = freshDb();
    const shifts: Record<string, "skip" | "advance"> = {};
    press(db, shifts, "2027-01-05", "skip");
    press(db, shifts, "2027-01-05", "advance");
    expect(shifts).toEqual({});
    expect(view(db)).toEqual(ORIGINAL);
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
      if (t.date <= "2027-01-12") continue; // 누른 칸(복사)과 그 앞은 그대로
      expect(view(db)[t.date.slice(5)]).toBe(t.progress);
    }
  });

  it("🔴 선생님이 고쳐 쓴 줄은 건드리지 않는다", () => {
    const db = freshDb();
    const edited = [...db.values()].find((l) => l.date === "2027-01-12")!;
    db.set(edited.id, { ...edited, progress: "Unit 4 복습" });
    press(db, {}, "2027-01-05", "skip");
    expect(view(db)["01-12"]).toBe("Unit 4 복습");
    expect(view(db)["01-15"]).toBe("Unit 4");
  });

  it("누른 칸 앞의 줄은 안 바뀐다", () => {
    const db = freshDb();
    press(db, {}, "2027-01-15", "skip");
    const v = view(db);
    expect([v["01-05"], v["01-08"], v["01-12"], v["01-15"]]).toEqual(["Unit 1 / Unit 2", "Unit 3", "Unit 4 / Unit 5", "Unit 6"]);
    expect(v["01-19"]).toBe("Unit 6 / Unit 7");
  });

  it("가져오기 전(실제 줄 없음)엔 아무것도 안 쓴다 — 표식만", () => {
    expect(planRelay({ kind: "skip", date: "2027-01-05", slot: SLOT, lines: [], targets: scheduleOf({}) })).toEqual({ ops: [], end: null });
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
