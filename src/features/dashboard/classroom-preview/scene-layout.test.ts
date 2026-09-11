import { describe, expect, it } from "vitest";
import { buildSceneLayout, classroomSeats, FLOOR_HALL_WIDTH, FLOOR_HEIGHT, roomMapState } from "./scene-layout";
import type { Classroom } from "./model";

const rooms = ["고수801", "고수802", "고수803", "고수804", "본원201", "본원202", "본원203", "본원204", "본원205", "본원SKY", "본원301", "본원302", "본원303", "본원304", "본원305", "본원601", "본원602", "본원603", "본원604", "본원605", "본원606"].map((name) => ({ id: name, name }));

describe("shared classroom map", () => {
  it("separates every building/floor and keeps SKY on the second floor", () => {
    const layout = buildSceneLayout(rooms);
    expect(layout.floors.map((floor) => floor.label)).toEqual(["본원 2층", "본원 3층", "본원 6층", "고수 8층"]);
    expect(layout.floors.find((floor) => floor.label === "본원 2층")?.roomIds).toContain("본원SKY");
    expect(layout.rooms).toHaveLength(rooms.length);
    expect(new Set(layout.floors.flatMap((floor) => floor.roomIds)).size).toBe(rooms.length);
    for (const floor of layout.floors) {
      for (const id of floor.roomIds) {
        const room = layout.rooms.find((room) => room.id === id)!;
        expect(room.x - room.width / 2).toBeGreaterThan(floor.x);
        expect(room.x + room.width / 2).toBeLessThan(floor.x + floor.width);
        expect(room.z - room.depth / 2).toBeGreaterThan(floor.z);
        expect(room.z + room.depth / 2).toBeLessThan(floor.z + floor.depth);
        expect(Math.abs(room.x - (floor.x + floor.width / 2)) - room.width / 2).toBeCloseTo(FLOOR_HALL_WIDTH / 2);
        const outerDistance = room.x < floor.x + floor.width / 2 ? room.x - room.width / 2 - floor.x : floor.x + floor.width - room.x - room.width / 2;
        expect(outerDistance).toBeCloseTo(.2);
      }
      for (const other of layout.floors.filter((other) => other !== floor)) {
        expect(floor.x + floor.width < other.x || other.x + other.width < floor.x || floor.z + floor.depth < other.z || other.z + other.depth < floor.z).toBe(true);
      }
    }
    for (const room of layout.rooms) for (const other of layout.rooms.filter((other) => other !== room)) {
      expect(Math.abs(room.x - other.x) >= (room.width + other.width) / 2 - .001 || Math.abs(room.z - other.z) >= (room.depth + other.depth) / 2 - .001).toBe(true);
    }
  });
  it("fits a filtered floor independently and safely handles no matching rooms", () => {
    const floor = buildSceneLayout(rooms.filter((room) => room.name.startsWith("본원6")));
    expect(floor.floors).toHaveLength(1);
    expect(floor.width).toBeLessThan(buildSceneLayout(rooms).width);
    expect(buildSceneLayout([])).toMatchObject({ rooms: [], floors: [], width: 1, depth: 1 });
  });
  it("stacks 2, 3, 6, 8 upward while preserving each square floor's local plan", () => {
    const flat = buildSceneLayout(rooms);
    const building = buildSceneLayout(rooms, true);
    expect(building.floors.map((floor) => floor.y)).toEqual([0, FLOOR_HEIGHT, FLOOR_HEIGHT * 2, FLOOR_HEIGHT * 3]);
    expect(building.height).toBe(FLOOR_HEIGHT * 3);
    for (const floor of building.floors) {
      expect(floor.width).toBe(floor.depth);
      const flatFloor = flat.floors.find((item) => item.key === floor.key)!;
      for (const id of floor.roomIds) {
        const room = building.rooms.find((room) => room.id === id)!;
        const flatRoom = flat.rooms.find((room) => room.id === id)!;
        expect(room.x - floor.x).toBeCloseTo(flatRoom.x - flatFloor.x);
        expect(room.z - floor.z).toBeCloseTo(flatRoom.z - flatFloor.z);
        expect(room.y).toBe(floor.y);
      }
    }
  });
  it("gives 305, 603 and JJ twice the area, with 6×4 seats versus 4×4", () => {
    const layout = buildSceneLayout([...rooms, { id: "jj", name: "본원JJ" }]);
    const regular = layout.rooms.find((r) => r.id === "본원201")!;
    for (const room of layout.rooms) {
      const large = ["본원305", "본원603", "jj"].includes(room.id);
      expect(room.lab).toBe(large);
      expect(room.width * room.depth).toBeCloseTo(regular.width * regular.depth * (large ? 2 : 1));
      const seats = classroomSeats(room);
      expect(seats).toHaveLength(large ? 24 : 16);
      expect(new Set(seats.map((s) => s.x)).size).toBe(large ? 6 : 4);
      expect(new Set(seats.map((s) => s.z)).size).toBe(4);
      for (const seat of seats) {
        expect(Math.abs(seat.x) + .6).toBeLessThan(room.depth / 2);
        expect(seat.z + .85).toBeLessThan(room.width / 2);
      }
    }
  });
  it("changes map status at exact timetable boundaries without inventing attendance", () => {
    const room: Classroom = { id: "r1", name: "본원201", capacity: 12, registered: true, lessons: [
      { id: "s1", classId: "c1", className: "영어", subject: "english", teacherName: "담당", studentCount: 7, startTime: "14:20:00", endTime: "15:00:00" },
    ] };
    expect(roomMapState(room, null).mapStatus).toBe("unknown");
    expect(roomMapState(room, 859).mapStatus).toBe("next");
    expect(roomMapState(room, 860).mapStatus).toBe("ongoing");
    expect(roomMapState(room, 900).mapStatus).toBe("idle");
    expect(roomMapState(room, 860).active[0].studentCount).toBe(7);
  });
});
