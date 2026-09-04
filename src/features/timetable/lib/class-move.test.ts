import { describe, expect, it } from "vitest";

import {
  blockersText,
  buildClassMoveIndex,
  buildClassMoveLookup,
  classMoveBlockers,
  isSeatSlot,
  movedEndTime,
  slotRoomKeyOf,
  slotTeacherOf,
  type MoveSlotLike,
  type MoveStudentLike,
} from "./class-move";

/** 끌고 있는 블록의 판정 재료 — 화면이 드래그 data로 들고 다니는 값과 같은 모양. */
const subjectOf = (s: MoveSlotLike) => ({
  slotId: s.id,
  classId: s.classId,
  teacher: slotTeacherOf(s),
  roomKey: slotRoomKeyOf(s),
  roomName: (s.slotRoomLabel ?? s.classroomName ?? "").trim(),
  seat: isSeatSlot(s),
  startTime: s.startTime,
  endTime: s.endTime,
});

/** 그 반만 색인에 담아 판정(화면은 뜬 반 전체를 한 번에 담는다). */
const check = (slot: MoveSlotLike, day: string, start: string, slots: MoveSlotLike[]) =>
  classMoveBlockers(subjectOf(slot), day, start, buildClassMoveLookup(buildClassMoveIndex(slots, [slot.classId])));

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
    const b = check(math, "tue", "17:30:00", slots);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "student", className: "LT3", names: ["박세하"] });
    expect(blockersText(b)).toContain("박세하");
  });

  it("경계만 닿는 칸은 겹침이 아니다", () => {
    // 영어 17:00~18:00 → 18:00 시작은 통과
    expect(check(math, "tue", "18:00:00", slots)).toEqual([]);
  });

  it("같은 반의 **다른 칸**이 그 시간에 있으면 막는다(한 반이 두 곳에 못 있는다)", () => {
    const other = slot({ id: "s3", classId: "c-math", className: "초등M 개별 B", dayOfWeek: "wed", students: math.students });
    const two = [math, other];
    expect(check(math, "wed", "16:20:00", two)).toEqual([{ kind: "self", className: "초등M 개별 B" }]);
    // 겹치지 않는 시각이면 통과(자기 칸이라고 무조건 막지 않는다).
    expect(check(math, "wed", "18:10:00", two)).toEqual([]);
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
    expect(check(math, "tue", "17:30:00", two)).toEqual([]);
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
      dayOfWeek: "tue",
      startTime: "16:20:00",
      endTime: "17:20:00",
      teacherName: "김은정",
      classroomName: "본원203",
    });
    const two = [base, other];
    const b = check(base, "tue", "16:20:00", two);
    expect(b).toEqual([{ kind: "teacher", teacher: "김은정", className: "B반" }]);
  });

  it("같은 방을 그 시간에 다른 반이 쓰면 막힌다", () => {
    const other = slot({
      id: "s3",
      classId: "c3",
      className: "C반",
      dayOfWeek: "tue",
      startTime: "16:20:00",
      endTime: "17:20:00",
      teacherName: "남정화",
      classroomName: "본원201",
    });
    const two = [base, other];
    const b = check(base, "tue", "16:20:00", two);
    expect(b).toEqual([{ kind: "room", room: "본원201", className: "C반" }]);
  });

  it("자리(LAB) 슬롯은 강사·강의실 축에서 빠진다", () => {
    const lab = slot({
      id: "s4",
      classId: "c4",
      className: "랩실",
      dayOfWeek: "tue",
      startTime: "16:20:00",
      endTime: "17:20:00",
      slotTeacherLabel: "LAB",
      slotRoomLabel: "LAB",
    });
    const mine = slot({ ...base, slotTeacherLabel: "LAB", slotRoomLabel: "LAB", id: "s5", classId: "c5" });
    const two = [mine, lab];
    expect(check(mine, "tue", "16:20:00", two)).toEqual([]);
  });

  it("자리에 앉아 있는 학생은 **학생 축에서는** 그대로 막는다", () => {
    const lab = slot({
      id: "s6",
      classId: "c6",
      className: "랩실",
      dayOfWeek: "tue",
      startTime: "16:20:00",
      endTime: "17:20:00",
      slotTeacherLabel: "LAB",
      slotRoomLabel: "LAB",
      students: [stu("a", "학생1")],
    });
    const two = [base, lab];
    const b = check(base, "tue", "16:20:00", two);
    expect(b.some((x) => x.kind === "student")).toBe(true);
  });

  it("실효 강사·강의실은 셀 override가 이긴다", () => {
    const s = slot({ id: "s7", classId: "c7", teacherName: "김은정", slotTeacherLabel: "Yoojin", classRoomId: "r1", slotRoomId: "r2" });
    expect(slotTeacherOf(s)).toBe("Yoojin");
    expect(slotRoomKeyOf(s)).toBe("id:r2");
  });
});
