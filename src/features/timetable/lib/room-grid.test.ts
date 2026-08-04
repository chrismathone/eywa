import { describe, expect, it } from "vitest";
import {
  LABEL_KEY_PREFIX,
  annotateOverlaps,
  buildRoomBuckets,
  classIntervalsExact,
  occupiedMinutes,
  roomKeyOf,
  type RoomInfo,
  type RoomSlotLite,
} from "./room-grid";

const slot = (over: Partial<RoomSlotLite>): RoomSlotLite => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  classId: "c1",
  className: "중등M 중1",
  subject: "math",
  dayOfWeek: "mon",
  startTime: "15:00",
  endTime: "15:50",
  teacherLabel: null,
  students: 8,
  classBgColor: null,
  classTextColor: null,
  isSpecialLecture: false,
  roomId: null,
  roomLabel: null,
  isSeat: false,
  ...over,
});

const ROOMS: RoomInfo[] = [
  { id: "r1", name: "본원301", capacity: 12 },
  { id: "r2", name: "본원302", capacity: null },
];

describe("roomKeyOf", () => {
  it("FK 우선 → 라벨 폴백 → null(미배정)", () => {
    expect(roomKeyOf({ roomId: "r1", roomLabel: "LAB" })).toBe("r1");
    expect(roomKeyOf({ roomId: null, roomLabel: "LAB" })).toBe(`${LABEL_KEY_PREFIX}LAB`);
    expect(roomKeyOf({ roomId: null, roomLabel: null })).toBeNull();
  });
});

describe("buildRoomBuckets", () => {
  it("등록 강의실은 수업이 없어도 버킷 생성(빈 교실이 화면의 존재 이유)", () => {
    const { buckets, unassigned } = buildRoomBuckets([slot({ roomId: "r1" })], ROOMS);
    expect(buckets.map((b) => b.key)).toEqual(["r1", "r2"]);
    expect(buckets[0]!.slots).toHaveLength(1);
    expect(buckets[1]!.slots).toHaveLength(0);
    expect(unassigned).toHaveLength(0);
  });

  it("라벨 전용 슬롯은 미등록 버킷(뒤에 가나다), 무배정은 unassigned로 분리", () => {
    const { buckets, unassigned } = buildRoomBuckets(
      [slot({ roomLabel: "LAB실" }), slot({ roomLabel: "301호" }), slot({})],
      ROOMS,
    );
    expect(buckets.map((b) => b.name)).toEqual(["본원301", "본원302", "301호", "LAB실"]);
    expect(buckets.filter((b) => !b.registered)).toHaveLength(2);
    expect(unassigned).toHaveLength(1);
  });

  it("rooms 목록에 없는 FK(삭제 레이스)는 라벨 이름으로 미등록 버킷", () => {
    const { buckets } = buildRoomBuckets([slot({ roomId: "ghost", roomLabel: "옛방" })], ROOMS);
    const ghost = buckets.find((b) => b.key === "ghost");
    expect(ghost?.registered).toBe(false);
    expect(ghost?.name).toBe("옛방");
  });
});

describe("classIntervalsExact", () => {
  it("같은 반 인접 교시를 실제 분 그대로 병합(격자 라운딩 없음)", () => {
    const out = classIntervalsExact([
      slot({ classId: "a", startTime: "15:00", endTime: "15:50" }),
      slot({ classId: "a", startTime: "15:50", endTime: "16:40" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startMin: 900, endMin: 1000 }); // 15:00~16:40 = 100분(60분 아님)
  });

  it("다른 반은 병합하지 않고, 시각 파싱 실패·역전 슬롯은 버린다", () => {
    const out = classIntervalsExact([
      slot({ classId: "a" }),
      slot({ classId: "b" }),
      slot({ classId: "c", startTime: "bad" }),
      slot({ classId: "d", startTime: "16:00", endTime: "16:00" }),
    ]);
    expect(out.map((iv) => iv.classId).sort()).toEqual(["a", "b"]);
  });
});

describe("annotateOverlaps", () => {
  it("완전 동일 범위=합반(joint), 부분 겹침=conflict — conflict가 우선하고 쌍 수를 센다", () => {
    const base = classIntervalsExact([
      slot({ classId: "a", startTime: "15:00", endTime: "16:00" }),
      slot({ classId: "b", startTime: "15:00", endTime: "16:00" }),
      slot({ classId: "c", startTime: "15:30", endTime: "16:30" }),
      slot({ classId: "d", startTime: "18:00", endTime: "19:00" }),
    ]);
    const { intervals, conflictPairs } = annotateOverlaps(base);
    const by = Object.fromEntries(intervals.map((iv) => [iv.classId, iv.overlap]));
    expect(by).toEqual({ a: "conflict", b: "conflict", c: "conflict", d: null });
    expect(conflictPairs).toBe(2); // a-c, b-c (a-b는 동일 범위 합반)
  });

  it("겹침 없으면 전부 null, 동일 범위 둘이면 joint", () => {
    const { intervals, conflictPairs } = annotateOverlaps(
      classIntervalsExact([
        slot({ classId: "a", startTime: "15:00", endTime: "16:00" }),
        slot({ classId: "b", startTime: "15:00", endTime: "16:00" }),
      ]),
    );
    expect(intervals.every((iv) => iv.overlap === "joint")).toBe(true);
    expect(conflictPairs).toBe(0);
  });
});

describe("occupiedMinutes", () => {
  it("겹치는 구간은 합집합으로 한 번만 센다", () => {
    expect(
      occupiedMinutes([
        { startMin: 900, endMin: 960 },
        { startMin: 930, endMin: 990 },
        { startMin: 1080, endMin: 1140 },
      ]),
    ).toBe(150); // 15:00~16:30(90) + 18:00~19:00(60)
    expect(occupiedMinutes([])).toBe(0);
  });
});
