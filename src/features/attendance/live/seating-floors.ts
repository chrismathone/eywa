/**
 * 좌석표를 **건물·층 → 강의실**로 묶는다(순수, Vitest).
 *
 * 층은 시간표와 같은 `roomGroupOf`(호수 앞자리). 호수만 있는 라벨(305)은 앞자리를 층으로 읽는다.
 * 방을 모르는 반은 맨 끝 「강의실 미지정」.
 */
import { roomGroupKey, roomGroupOf, type RoomGroup } from "@/features/timetable/lib/room-groups";
import { SEAT_ROOM_META } from "./seating-bands";
import type { SeatingClass } from "./seating";

export type SeatingRoom = {
  key: string;
  roomName: string;
  classes: SeatingClass[];
};

export type SeatingFloor = {
  key: string;
  label: string;
  unmarked: number;
  rooms: SeatingRoom[];
};

const UNASSIGNED: RoomGroup = {
  building: "미지정",
  floor: null,
  label: "강의실 미지정",
  order: Number.MAX_SAFE_INTEGER,
};

function pickName(v?: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * 그 교시의 강의실 이름.
 * 슬롯 FK(본원305)가 층 묶음의 근거라 라벨(305)보다 앞. 라벨만 있으면 그걸 쓴다.
 */
export function resolveRoomName(args: {
  slotClassroomName?: string | null;
  slotRoomLabel?: string | null;
  classClassroomName?: string | null;
}): string | null {
  return pickName(args.slotClassroomName) ?? pickName(args.slotRoomLabel) ?? pickName(args.classClassroomName);
}

/** 좌석표용 층 — roomGroupOf + 호수-only + 미지정. */
export function seatingFloorOf(roomName: string | null | undefined): RoomGroup {
  const name = pickName(roomName);
  if (!name) return UNASSIGNED;
  const g = roomGroupOf(name);
  if (g.floor != null) return g;
  const digits = /^(\d+)$/.exec(name);
  if (digits) {
    const no = Number(digits[1]);
    const floor = Number(String(no)[0]!);
    return { building: "호수", floor, label: `${floor}층`, order: no };
  }
  return g;
}

export function groupSeatingFloors(classes: readonly SeatingClass[]): SeatingFloor[] {
  const buildingOrder = new Map<string, number>();
  const tagged = classes.map((klass) => {
    const seat = klass.seatLabel ? SEAT_ROOM_META[klass.seatLabel] : null;
    const group = seatingFloorOf(seat?.floorRoom ?? klass.roomName);
    if (group.building !== UNASSIGNED.building && !buildingOrder.has(group.building)) {
      buildingOrder.set(group.building, buildingOrder.size);
    }
    const roomLabel = seat?.roomName ?? pickName(klass.roomName) ?? UNASSIGNED.label;
    return { klass, group, roomKey: roomLabel, roomLabel };
  });
  tagged.sort((a, b) => {
    const ua = a.group.building === UNASSIGNED.building;
    const ub = b.group.building === UNASSIGNED.building;
    if (ua !== ub) return ua ? 1 : -1;
    const ba = buildingOrder.get(a.group.building) ?? 0;
    const bb = buildingOrder.get(b.group.building) ?? 0;
    if (ba !== bb) return ba - bb;
    const fa = a.group.floor ?? Number.MAX_SAFE_INTEGER;
    const fb = b.group.floor ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    if (a.group.order !== b.group.order) return a.group.order - b.group.order;
    const rn = a.roomLabel.localeCompare(b.roomLabel, "ko");
    if (rn !== 0) return rn;
    if (a.klass.firstStart !== b.klass.firstStart) return a.klass.firstStart < b.klass.firstStart ? -1 : 1;
    return a.klass.className.localeCompare(b.klass.className, "ko");
  });

  const floors: SeatingFloor[] = [];
  for (const t of tagged) {
    const fkey = roomGroupKey(t.group);
    let floor = floors[floors.length - 1];
    if (!floor || floor.key !== fkey) {
      floor = { key: fkey, label: t.group.label, unmarked: 0, rooms: [] };
      floors.push(floor);
    }
    let room = floor.rooms[floor.rooms.length - 1];
    if (!room || room.key !== t.roomKey) {
      room = { key: t.roomKey, roomName: t.roomLabel, classes: [] };
      floor.rooms.push(room);
    }
    room.classes.push(t.klass);
    floor.unmarked += t.klass.students.filter((s) => s.mark === "unmarked").length;
  }
  return floors;
}
