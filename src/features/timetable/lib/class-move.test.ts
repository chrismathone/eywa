import { describe, expect, it } from "vitest";

import {
  blockersText,
  buildClassMoveIndex,
  buildClassMoveLookup,
  classMoveBlockers,
  isSeatSlot,
  movedEndTime,
  placeBlock,
  slotRoomIdOf,
  slotRoomNameOf,
  slotRoomTokOf,
  slotTeacherOf,
  toMinutes,
  type MovePart,
  type MoveSlotLike,
  type MoveStudentLike,
  type MoveSubject,
} from "./class-move";

/** 영어 교시 몇 개 — 목적지 행의 시작시각(격자가 칸 속성으로 들고 있는 값). */
const ROWS = ["16:20:00", "17:00:00", "17:40:00", "18:20:00", "19:20:00"];
const WEEK = ["mon", "thu"];

const partOf = (s: MoveSlotLike, rowOffset = 0, dayOffset = 0): MovePart => ({
  slotId: s.id,
  rowOffset,
  dayOffset,
  durMin: toMinutes(s.endTime) - toMinutes(s.startTime),
});

/** 끌고 있는 블록의 판정 재료 — 화면이 드래그 data로 들고 다니는 값과 같은 모양. */
const subjectOf = (s: MoveSlotLike, parts?: MovePart[]): MoveSubject => ({
  slotId: s.id,
  classId: s.classId,
  teacher: slotTeacherOf(s),
  roomId: slotRoomIdOf(s),
  roomTok: slotRoomTokOf(s),
  roomName: slotRoomNameOf(s),
  seat: isSeatSlot(s),
  parts: parts ?? [partOf(s)],
});

/** 그 반만 색인에 담아 판정(화면은 뜬 반 전체를 한 번에 담는다). */
function check(slot: MoveSlotLike, day: string, start: string, slots: MoveSlotLike[], parts?: MovePart[]) {
  const rowIndex = ROWS.indexOf(start);
  const dayIndex = WEEK.indexOf(day) >= 0 ? WEEK.indexOf(day) : 0;
  return classMoveBlockers(
    subjectOf(slot, parts),
    {
      groupDays: WEEK.includes(day) ? WEEK : [day],
      dayIndex,
      rowStarts: rowIndex >= 0 ? ROWS : [start],
      rowIndex: rowIndex >= 0 ? rowIndex : 0,
    },
    buildClassMoveLookup(buildClassMoveIndex(slots, [slot.classId])),
  );
}

const stu = (id: string, name: string, extra: Partial<MoveStudentLike> = {}): MoveStudentLike => ({
  studentId: id,
  name,
  status: "active",
  ...extra,
});

function slot(over: Partial<MoveSlotLike> & { id: string; classId: string }): MoveSlotLike {
  return {
    className: over.classId,
    dayOfWeek: "mon",
    startTime: "16:20:00",
    endTime: "18:10:00",
    teacherName: null,
    slotTeacherLabel: null,
    slotRoomId: null,
    classRoomId: null,
    classroomName: null,
    slotRoomLabel: null,
    students: [],
    ...over,
  };
}

describe("길이 보존 — 목적지 교시의 끝시각을 따라가지 않는다(시수)", () => {
  it("60분 수업을 40분 교시로 옮겨도 60분", () => {
    expect(movedEndTime({ startTime: "16:20:00", endTime: "17:20:00" }, "14:30:00")).toBe("15:30:00");
  });
  it("110분 수업도 그대로", () => {
    expect(movedEndTime({ startTime: "16:20:00", endTime: "18:10:00" }, "18:20:00")).toBe("20:10:00");
  });
});

describe("블록 배치 — 모양(교시·요일)을 유지한 채 옮긴다", () => {
  const a = slot({ id: "a", classId: "c", startTime: "16:20:00", endTime: "17:00:00" });
  const b = slot({ id: "b", classId: "c", startTime: "17:00:00", endTime: "17:40:00" });
  const parts = [partOf(a, 0, 0), partOf(b, 1, 0)];

  it("연속 두 교시 블록은 두 줄이 함께 간다(각자 원래 길이로)", () => {
    const placed = placeBlock(subjectOf(a, parts), { groupDays: WEEK, dayIndex: 0, rowStarts: ROWS, rowIndex: 2 });
    expect(placed).toEqual([
      { slotId: "a", day: "mon", start: "17:40:00", end: "18:20:00" },
      { slotId: "b", day: "mon", start: "18:20:00", end: "19:00:00" },
    ]);
  });

  it("월목 병합 블록을 화요일에 놓으면 화·금으로 간다(그룹 안 자리 유지)", () => {
    const thu = slot({ id: "b2", classId: "c", dayOfWeek: "thu", startTime: "16:20:00", endTime: "17:00:00" });
    const two = [partOf(a, 0, 0), partOf(thu, 0, 1)];
    const placed = placeBlock(subjectOf(a, two), {
      groupDays: ["tue", "fri"],
      dayIndex: 0,
      rowStarts: ROWS,
      rowIndex: 0,
    });
    expect(placed).toEqual([
      { slotId: "a", day: "tue", start: "16:20:00", end: "17:00:00" },
      { slotId: "b2", day: "fri", start: "16:20:00", end: "17:00:00" },
    ]);
  });

  it("격자를 벗어나면 놓을 수 없다(아래 교시·옆 요일이 없다)", () => {
    expect(placeBlock(subjectOf(a, parts), { groupDays: WEEK, dayIndex: 0, rowStarts: ROWS, rowIndex: 4 })).toBeNull();
    const wide = [partOf(a, 0, 0), partOf(b, 0, 1)];
    expect(
      placeBlock(subjectOf(a, wide), { groupDays: ["wed"], dayIndex: 0, rowStarts: ROWS, rowIndex: 0 }),
    ).toBeNull();
  });

  it("옮긴 줄끼리 시간이 겹치면 놓을 수 없다(그 반이 자기와 부딪힌다)", () => {
    // 60분 두 줄을 40분 간격 교시에 나란히 놓으면 겹친다.
    const long1 = slot({ id: "l1", classId: "c", startTime: "16:20:00", endTime: "17:20:00" });
    const long2 = slot({ id: "l2", classId: "c", startTime: "18:20:00", endTime: "19:20:00" });
    const both = [partOf(long1, 0, 0), partOf(long2, 1, 0)];
    expect(placeBlock(subjectOf(long1, both), { groupDays: WEEK, dayIndex: 0, rowStarts: ROWS, rowIndex: 0 })).toBeNull();
  });

  it("놓을 수 없는 자리는 이유를 말한다(빈 배열로 통과시키지 않는다)", () => {
    const b2 = check(a, "mon", "19:20:00", [a, b], parts);
    expect(b2).toEqual([{ kind: "shape" }]);
    expect(blockersText(b2)).toContain("들어가지 않습니다");
  });
});

describe("학생 축 — 모든 과목을 본다", () => {
  const math = slot({
    id: "s1",
    classId: "c-math",
    className: "초등M 개별 B",
    dayOfWeek: "mon",
    startTime: "16:20:00",
    endTime: "18:10:00",
    students: [stu("a", "박세하"), stu("b", "이서현")],
  });
  const english = slot({
    id: "s2",
    classId: "c-eng",
    className: "LT3",
    dayOfWeek: "tue",
    startTime: "17:00:00",
    endTime: "18:00:00",
    students: [stu("a", "박세하")],
  });
  const slots = [math, english];

  it("영어 수업과 겹치는 화요일 칸은 막힌다(과목이 달라도)", () => {
    const b = check(math, "tue", "17:00:00", slots);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "student", className: "LT3", names: ["박세하"] });
    expect(blockersText(b)).toContain("박세하");
  });

  it("경계만 닿는 칸은 겹침이 아니다", () => {
    // 영어 17:00~18:00 → 18:20 시작은 통과
    expect(check(math, "tue", "18:20:00", slots)).toEqual([]);
  });

  it("같은 반의 **다른 칸**이 그 시간에 있으면 막는다(한 반이 두 곳에 못 있는다)", () => {
    const other = slot({ id: "s3", classId: "c-math", className: "초등M 개별 B", dayOfWeek: "thu", students: math.students });
    const two = [math, other];
    expect(check(math, "thu", "16:20:00", two)).toEqual([{ kind: "self", className: "초등M 개별 B" }]);
    // 겹치지 않는 시각이면 통과(자기 칸이라고 무조건 막지 않는다).
    expect(check(math, "thu", "18:20:00", two)).toEqual([]);
  });

  it("**함께 옮기는** 줄은 자기 자신이라 서로를 막지 않는다", () => {
    const first = slot({ id: "m1", classId: "c-m", className: "M반", dayOfWeek: "mon", startTime: "16:20:00", endTime: "17:00:00", students: [stu("a", "박세하")] });
    const second = slot({ id: "m2", classId: "c-m", className: "M반", dayOfWeek: "mon", startTime: "17:00:00", endTime: "17:40:00", students: [stu("a", "박세하")] });
    const parts = [partOf(first, 0, 0), partOf(second, 1, 0)];
    expect(check(first, "mon", "17:40:00", [first, second], parts)).toEqual([]);
  });

  it("대기·퇴원 학생은 안 센다(그 시간에 오지 않는다)", () => {
    const hold = slot({
      id: "s4",
      classId: "c-x",
      className: "다른반",
      dayOfWeek: "tue",
      startTime: "17:00:00",
      endTime: "18:00:00",
      students: [stu("a", "박세하", { status: "hold" })],
    });
    const two = [math, hold];
    expect(check(math, "tue", "17:00:00", two)).toEqual([]);
  });

  it("분리등원 — 목요일만 오는 학생은 월요일 칸을 막지 않는다", () => {
    const split = slot({
      id: "s5",
      classId: "c-y",
      className: "분리반",
      dayOfWeek: "mon",
      startTime: "16:20:00",
      endTime: "18:10:00",
      students: [stu("a", "박세하", { attendanceDays: ["thu"] })],
    });
    const two = [math, split];
    expect(check(math, "mon", "16:20:00", two)).toEqual([]);
  });

  it("분리등원 — 옮기는 반 쪽 학생도 목적지 요일 기준으로 본다", () => {
    const src = slot({
      id: "s6",
      classId: "c-src",
      className: "월목반",
      dayOfWeek: "mon",
      students: [stu("a", "박세하", { attendanceDays: ["thu"] })],
    });
    const clash = slot({
      id: "s7",
      classId: "c-clash",
      className: "겹칠반",
      dayOfWeek: "mon",
      startTime: "16:20:00",
      endTime: "18:10:00",
      students: [stu("a", "박세하")],
    });
    const two = [src, clash];
    // 그 학생은 월요일엔 안 오므로 월요일로 옮겨도 그 학생 때문에 막히지 않는다.
    expect(check(src, "mon", "16:20:00", two)).toEqual([]);
  });
});

describe("강사·강의실 축 — 자리(LAB·JJ)는 빼고, 학생 축에선 뺀 적 없다", () => {
  const base = slot({
    id: "s1",
    classId: "c1",
    className: "A반",
    dayOfWeek: "mon",
    startTime: "16:20:00",
    endTime: "17:20:00",
    teacherName: "김은정",
    classroomName: "본원201",
    students: [stu("a", "학생1")],
  });

  it("같은 강사가 그 시간에 다른 반이면 막힌다", () => {
    const other = slot({
      id: "s2",
      classId: "c2",
      className: "B반",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      teacherName: "김은정",
      classroomName: "본원203",
    });
    const two = [base, other];
    const b = check(base, "thu", "16:20:00", two);
    expect(b).toEqual([{ kind: "teacher", teacher: "김은정", className: "B반" }]);
  });

  it("같은 방을 그 시간에 다른 반이 쓰면 막힌다", () => {
    const other = slot({
      id: "s3",
      classId: "c3",
      className: "C반",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      teacherName: "남정화",
      classroomName: "본원201",
    });
    const two = [base, other];
    const b = check(base, "thu", "16:20:00", two);
    expect(b).toEqual([{ kind: "room", room: "본원201", className: "C반" }]);
  });

  it("같은 방인데 한쪽만 FK로 들어 있어도 같은 방으로 본다(`본원201` ↔ `201`)", () => {
    const other = slot({
      id: "s3b",
      classId: "c3b",
      className: "D반",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      teacherName: "남정화",
      classroomName: "201",
    });
    const b = check(base, "thu", "16:20:00", [base, other]);
    expect(b).toEqual([{ kind: "room", room: "본원201", className: "D반" }]);
  });

  it("자리(LAB) 슬롯은 강사·강의실 축에서 빠진다", () => {
    const lab = slot({
      id: "s4",
      classId: "c4",
      className: "랩실",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      slotTeacherLabel: "LAB",
      slotRoomLabel: "LAB",
    });
    const mine = slot({ ...base, slotTeacherLabel: "LAB", slotRoomLabel: "LAB", id: "s5", classId: "c5" });
    const two = [mine, lab];
    expect(check(mine, "thu", "16:20:00", two)).toEqual([]);
  });

  it("**자기 반**의 자리(LAB) 칸은 self로 막는다(그 시간에 우리 아이들이 거기 앉아 있다)", () => {
    const myLab = slot({
      id: "s8",
      classId: "c1",
      className: "A반",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      slotTeacherLabel: "LAB",
      slotRoomLabel: "LAB",
      students: [stu("a", "학생1")],
    });
    expect(check(base, "thu", "16:20:00", [base, myLab])).toEqual([{ kind: "self", className: "A반" }]);
    // 겹치지 않는 시각이면 통과.
    expect(check(base, "thu", "18:20:00", [base, myLab])).toEqual([]);
  });

  it("자리에 앉아 있는 학생은 **학생 축에서는** 그대로 막는다", () => {
    const lab = slot({
      id: "s6",
      classId: "c6",
      className: "랩실",
      dayOfWeek: "thu",
      startTime: "16:20:00",
      endTime: "17:20:00",
      slotTeacherLabel: "LAB",
      slotRoomLabel: "LAB",
      students: [stu("a", "학생1")],
    });
    const two = [base, lab];
    const b = check(base, "thu", "16:20:00", two);
    expect(b.some((x) => x.kind === "student")).toBe(true);
  });

  it("실효 강사·강의실은 셀 override가 이긴다", () => {
    const s = slot({ id: "s7", classId: "c7", teacherName: "김은정", slotTeacherLabel: "Yoojin", classRoomId: "r1", slotRoomId: "r2" });
    expect(slotTeacherOf(s)).toBe("Yoojin");
    expect(slotRoomIdOf(s)).toBe("r2");
  });
});
