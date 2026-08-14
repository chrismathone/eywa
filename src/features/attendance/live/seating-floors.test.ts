import { describe, expect, it } from "vitest";
import { foldSeating } from "./seating";
import { groupSeatingFloors, resolveRoomName, seatingFloorOf } from "./seating-floors";
import type { LiveBoardSlot } from "./types";

const slot = (over: Partial<LiveBoardSlot> & { key: string; slotStart: string }): LiveBoardSlot => ({
  classId: over.classId ?? over.key,
  className: over.className ?? over.key,
  subject: "math",
  saveSlot: null,
  slotEnd: "17:20",
  periodLabel: null,
  teacherId: null,
  teacherName: "김강사",
  slotTeacherLabel: null,
  roomName: over.roomName ?? null,
  students: over.students ?? [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  ownedByMe: false,
  ...over,
});

const kid = (name: string, status: string | null = null) => ({
  studentId: name,
  studentName: name,
  schoolGrade: null,
  parentPhone: null,
  studentPhone: null,
  status,
  note: null,
  signal: status ? null : ("unmarked" as const),
  recordedAt: status ? "T" : null,
  recordSlot: null,
});

describe("resolveRoomName", () => {
  it("슬롯 FK 이름이 라벨보다 앞 — 층 묶음은 본원305가 근거", () => {
    expect(
      resolveRoomName({
        slotClassroomName: "본원305",
        slotRoomLabel: "305",
        classClassroomName: "본원201",
      }),
    ).toBe("본원305");
  });

  it("FK가 없으면 슬롯 라벨, 그것도 없으면 반 기본", () => {
    expect(resolveRoomName({ slotRoomLabel: "본원SKY", classClassroomName: "본원201" })).toBe("본원SKY");
    expect(resolveRoomName({ classClassroomName: "본원201" })).toBe("본원201");
    expect(resolveRoomName({})).toBeNull();
  });
});

describe("seatingFloorOf", () => {
  it("호수 앞자리 = 층 — 시간표와 같은 규약", () => {
    expect(seatingFloorOf("본원305")).toMatchObject({ building: "본원", floor: 3, label: "본원 3층" });
    expect(seatingFloorOf("본원SKY")).toMatchObject({ building: "본원", floor: 2, label: "본원 2층" });
  });

  it("호수만 있어도 앞자리를 층으로 읽는다", () => {
    expect(seatingFloorOf("305")).toMatchObject({ floor: 3, label: "3층" });
  });

  it("방 없는 반은 미지정", () => {
    expect(seatingFloorOf(null)).toMatchObject({ label: "강의실 미지정" });
    expect(seatingFloorOf("  ")).toMatchObject({ label: "강의실 미지정" });
  });
});

describe("groupSeatingFloors", () => {
  it("같은 층끼리 묶고 호수 순 — 미지정은 맨 끝", () => {
    const floors = groupSeatingFloors(
      foldSeating([
        slot({ key: "a", className: "A", slotStart: "16:20", roomName: "본원305" }),
        slot({ key: "b", className: "B", slotStart: "14:30", roomName: "본원201" }),
        slot({ key: "c", className: "C", slotStart: "15:00", roomName: null }),
        slot({ key: "d", className: "D", slotStart: "15:30", roomName: "본원205" }),
        slot({ key: "e", className: "E", slotStart: "16:00", roomName: "고수801" }),
      ]),
    );
    // 건물 순 = 오늘 가장 이른 반이 있는 건물(시간표처럼 가나다가 아님).
    expect(floors.map((f) => f.label)).toEqual(["본원 2층", "본원 3층", "고수 8층", "강의실 미지정"]);
    expect(floors[0]?.rooms.map((r) => r.roomName)).toEqual(["본원201", "본원205"]);
    expect(floors[1]?.rooms.map((r) => r.roomName)).toEqual(["본원305"]);
  });

  it("같은 강의실의 반은 한 방 아래에 시각 순", () => {
    const floors = groupSeatingFloors(
      foldSeating([
        slot({ key: "late", classId: "c2", className: "늦은반", slotStart: "18:20", roomName: "본원305" }),
        slot({ key: "early", classId: "c1", className: "이른반", slotStart: "14:30", roomName: "본원305" }),
      ]),
    );
    expect(floors).toHaveLength(1);
    expect(floors[0]?.rooms).toHaveLength(1);
    expect(floors[0]?.rooms[0]?.classes.map((c) => c.className)).toEqual(["이른반", "늦은반"]);
  });

  it("층 미출결 수는 그 층 칸만", () => {
    const floors = groupSeatingFloors(
      foldSeating([
        slot({
          key: "up",
          slotStart: "16:20",
          roomName: "본원601",
          students: [kid("빈칸"), kid("왔다", "present")],
        }),
        slot({
          key: "down",
          slotStart: "16:20",
          roomName: "본원201",
          students: [kid("결석", "absent")],
        }),
      ]),
    );
    expect(floors.find((f) => f.label === "본원 6층")?.unmarked).toBe(1);
    expect(floors.find((f) => f.label === "본원 2층")?.unmarked).toBe(0);
  });
});
