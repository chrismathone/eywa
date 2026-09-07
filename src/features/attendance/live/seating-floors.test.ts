import { describe, expect, it } from "vitest";
import { foldSeating } from "./seating";
import {
  canonicalRoomName,
  groupSeatingFloors,
  resolveRoomName,
  seatingFloorOf,
} from "./seating-floors";
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
  band: "now",
  ownedByMe: false,
  ...over,
});

const kid = (name: string, status: string | null = null) => ({
  studentId: name,
  studentName: name,
  englishName: null,
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

describe("canonicalRoomName", () => {
  // 실측 명단(injaewon) — 같은 호수가 두 건물에 있는 602가 애매성 사례다.
  const ROOMS = [
    "고수801",
    "바른602",
    "본원201",
    "본원301",
    "본원302",
    "본원305",
    "본원602",
    "본원SKY",
  ];

  it("맨숫자 라벨을 등록된 강의실 이름으로 맞춘다 — 302 → 본원302", () => {
    expect(canonicalRoomName("302", ROOMS)).toBe("본원302");
    expect(canonicalRoomName("SKY", ROOMS)).toBe("본원SKY");
  });

  it("애매하면 손대지 않는다 — 602는 바른·본원 둘에 걸린다", () => {
    expect(canonicalRoomName("602", ROOMS)).toBe("602");
  });

  it("건물명이 이미 붙었거나 등록된 이름이면 그대로", () => {
    expect(canonicalRoomName("본원302", ROOMS)).toBe("본원302");
    expect(canonicalRoomName("랩실", ROOMS)).toBe("랩실");
    expect(canonicalRoomName("LAB실", ROOMS)).toBe("LAB실");
  });

  it("모르는 호수·빈 값은 그대로 — 없는 방을 지어내지 않는다", () => {
    expect(canonicalRoomName("999", ROOMS)).toBe("999");
    expect(canonicalRoomName("  ", ROOMS)).toBeNull();
    expect(canonicalRoomName(null, ROOMS)).toBeNull();
    expect(canonicalRoomName("302", [])).toBe("302");
  });

  it("접미사 앞이 숫자면 후보가 아니다 — 호수의 일부를 라벨로 오인하지 않게", () => {
    expect(canonicalRoomName("302", ["본원1302"])).toBe("302");
  });

  it("맞춘 뒤엔 본원 3층으로 묶인다 — 이 함수가 존재하는 이유", () => {
    expect(seatingFloorOf("302")).toMatchObject({ building: "호수", label: "3층" });
    expect(seatingFloorOf(canonicalRoomName("302", ROOMS))).toMatchObject({
      building: "본원",
      floor: 3,
      label: "본원 3층",
    });
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

  it("LAB는 본원603에 있어도 랩실(603호)로 따로 선다 — 일반 반과 4열을 나누지 않는다", () => {
    const floors = groupSeatingFloors(
      foldSeating([
        slot({
          key: "lab",
          className: "LT3",
          slotStart: "15:00",
          roomName: "본원603",
          slotTeacherLabel: "LAB",
        }),
        slot({ key: "reg", className: "고등E", slotStart: "15:00", roomName: "본원603" }),
      ]),
    );
    const floor = floors.find((f) => f.label === "본원 6층");
    expect(floor?.rooms.map((r) => r.roomName)).toEqual(["랩실(603호)", "본원603"]);
    expect(floor?.rooms.find((r) => r.roomName === "랩실(603호)")?.classes.map((c) => c.className)).toEqual([
      "LT3",
    ]);
  });

  it("방 이름이 랩실·JJ실만 있어도 호수 층으로 선다", () => {
    const floors = groupSeatingFloors(
      foldSeating([
        slot({ key: "lab", className: "LT3", slotStart: "15:00", roomName: "랩실", slotTeacherLabel: "LAB" }),
        slot({ key: "jj", className: "LS2", slotStart: "15:00", roomName: "JJ실", slotTeacherLabel: "JJ" }),
      ]),
    );
    expect(floors.find((f) => f.label === "본원 6층")?.rooms.map((r) => r.roomName)).toEqual(["랩실(603호)"]);
    expect(floors.find((f) => f.label === "본원 3층")?.rooms.map((r) => r.roomName)).toEqual(["JJ실(305호)"]);
  });
});
