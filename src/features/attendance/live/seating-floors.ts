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

/**
 * 라벨을 **등록된 강의실 이름**으로 맞춘다 — 맨숫자 라벨(`302`)이 층 묶음에서 떨어져 나가는 것 방어.
 *
 * 🔴 왜 필요한가(2026-08-25 실사고): 영어 시트가 넣는 `slot_room_label`은 `302`처럼 **건물명이 없는
 *    호수**다. 평소엔 슬롯의 강의실 FK(`본원302`)가 먼저라 안 보이지만, 반 수정 저장 한 번이 그 FK를
 *    비우면(폼의 교시별 강의실 칸이 빈 채 제출) 라벨이 그대로 화면에 나온다. 그러면 `roomGroupOf`가
 *    건물을 못 읽어 **`본원 3층`이 아니라 별도 `3층`(건물=호수)** 으로 갈라진다 — 같은 3층인데 묶음이
 *    둘이 되고, 카드 제목도 `본원302`가 아니라 `302`가 된다(실측: 08-24 브릿지 C 월 17:20).
 *
 * ⚠️ **애매하면 손대지 않는다**(fail-soft). `602`는 `바른602`·`본원602` 둘에 걸리므로 그대로 둔다 —
 *    임의로 하나를 고르면 없는 건물에 방을 옮겨 놓는 셈이라, 갈라진 묶음보다 나쁘다.
 * ⚠️ 접미사 앞이 숫자면(가상의 `본원1302`) 후보에서 뺀다 — 호수의 일부를 라벨로 오인하지 않게.
 */
export function canonicalRoomName(
  name: string | null | undefined,
  knownNames: readonly string[],
): string | null {
  const label = pickName(name);
  if (!label) return null;
  // 건물명이 붙은 이름(본원302)·이미 등록된 이름은 그대로. 맨숫자/영문 접미사만 후보로 본다.
  if (!/^[0-9A-Za-z]+$/.test(label)) return label;
  const matches = knownNames.filter((n) => {
    if (n === label) return true;
    if (!n.endsWith(label)) return false;
    const head = n.slice(0, n.length - label.length);
    return head.length > 0 && !/\d$/.test(head);
  });
  if (matches.includes(label)) return label; // 등록된 이름 그 자체
  return matches.length === 1 ? matches[0]! : label;
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
