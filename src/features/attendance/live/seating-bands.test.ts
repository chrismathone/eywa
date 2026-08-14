import { describe, expect, it } from "vitest";
import { groupSeatPeriods, isSeatRoom, SEAT_ROOM_META } from "./seating-bands";
import { foldSeating } from "./seating";
import type { LiveBoardSlot } from "./types";

const slot = (over: Partial<LiveBoardSlot> & { key: string; slotStart: string }): LiveBoardSlot => ({
  classId: over.classId ?? over.key,
  className: over.className ?? over.key,
  subject: "english",
  saveSlot: over.slotStart,
  slotEnd: over.slotEnd ?? "15:40",
  periodLabel: null,
  teacherId: null,
  teacherName: null,
  slotTeacherLabel: over.slotTeacherLabel ?? "LAB",
  roomName: over.roomName ?? "랩실",
  students: [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  ownedByMe: false,
  ...over,
});

describe("SEAT_ROOM_META", () => {
  it("랩실=603 · JJ=305", () => {
    expect(SEAT_ROOM_META.LAB).toEqual({ roomName: "랩실(603호)", floorRoom: "본원603" });
    expect(SEAT_ROOM_META.JJ).toEqual({ roomName: "JJ실(305호)", floorRoom: "본원305" });
  });
});

describe("isSeatRoom", () => {
  it("LAB·JJ 반이 하나라도 있으면 자리 방", () => {
    const [klass] = foldSeating([slot({ key: "lt3", slotStart: "15:00" })]);
    expect(klass?.seatLabel).toBe("LAB");
    expect(isSeatRoom({ roomName: "본원603", classes: klass ? [klass] : [] })).toBe(true);
  });

  it("일반 강의실은 아니다", () => {
    const [klass] = foldSeating([
      slot({ key: "bs", slotStart: "16:20", slotTeacherLabel: null, roomName: "본원201" }),
    ]);
    expect(isSeatRoom({ roomName: "본원201", classes: klass ? [klass] : [] })).toBe(false);
  });
});

describe("groupSeatPeriods", () => {
  it("같은 시각은 한 줄 — 목 4교시처럼 5반이 같이 선다", () => {
    const classes = foldSeating([
      slot({ key: "kw2", className: "KW2", slotStart: "18:20", slotEnd: "19:00" }),
      slot({ key: "ls3b", className: "LS3b", slotStart: "18:20", slotEnd: "19:00" }),
      slot({ key: "lt5", className: "LT5", slotStart: "18:20", slotEnd: "19:00" }),
      slot({ key: "pj6", className: "PJ6", slotStart: "18:20", slotEnd: "19:00" }),
      slot({ key: "ls6", className: "LS6", slotStart: "18:20", slotEnd: "19:00" }),
      slot({ key: "ls5", className: "LS5", slotStart: "19:10", slotEnd: "19:50" }),
    ]);
    const bands = groupSeatPeriods(classes);
    expect(bands).toHaveLength(2);
    expect(bands[0]?.start).toBe("18:20");
    expect(bands[0]?.end).toBe("19:00");
    expect(bands[0]?.classes.map((c) => c.className)).toEqual(["KW2", "LS3b", "LS6", "LT5", "PJ6"]);
    expect(bands[1]?.classes.map((c) => c.className)).toEqual(["LS5"]);
  });
});
