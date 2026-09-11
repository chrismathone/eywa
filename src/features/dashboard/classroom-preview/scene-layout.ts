import { roomGroupKey, roomGroupOf } from "@/features/timetable/lib/room-groups";
import { roomAt, type Classroom } from "./model";

export const ROOM_WIDTH = 6.3;
export const ROOM_DEPTH = 5.4;
export const FLOOR_HALL_WIDTH = 5.8;
export const FLOOR_HEIGHT = 5;
const FLOOR_GAP = 5.5;
export const MAP_COLORS = { ongoing: "#438a9d", next: "#c89b54", idle: "#c8d3de", unknown: "#bdc2c8" };
export type PlacedRoom = { id: string; label: string; floorKey: string; x: number; y: number; z: number; rotation: number; labelX: number; width: number; depth: number; scaleX: number; scaleZ: number; lab: boolean };
export type FloorPlate = { key: string; label: string; x: number; y: number; z: number; width: number; depth: number; roomIds: string[] };
export type SceneLayout = { rooms: PlacedRoom[]; floors: FloorPlate[]; width: number; height: number; depth: number; stacked: boolean };

export function classroomSeats(room: Pick<PlacedRoom, "lab" | "width" | "depth">, count = room.lab ? 24 : 16) {
  const columns = room.lab ? 6 : 4;
  const rows = Math.max(4, Math.ceil(count / columns));
  return Array.from({ length: count }, (_, i) => ({
    x: -room.depth / 2 + 1 + (i % columns) * (room.depth - 2) / (columns - 1),
    z: -room.width / 2 + 2 + Math.floor(i / columns) * (room.width - 3.4) / (rows - 1),
  }));
}

export function sortClassroomsByFloor<T extends Pick<Classroom, "name">>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => {
    const x = roomGroupOf(a.name), y = roomGroupOf(b.name);
    return (x.floor ?? 999) - (y.floor ?? 999) || x.building.localeCompare(y.building, "ko") || x.order - y.order || a.name.localeCompare(b.name, "ko");
  });
}

/** Shared coordinates for SVG and WebGL. Conceptual placement, never a claimed floor plan. */
export function buildSceneLayout(rooms: Pick<Classroom, "id" | "name">[], stacked = false): SceneLayout {
  if (!rooms.length) return { rooms: [], floors: [], width: 1, height: 0, depth: 1, stacked };
  const grouped = new Map<string, { label: string; rooms: Pick<Classroom, "id" | "name">[] }>();
  for (const room of sortClassroomsByFloor(rooms)) {
    const group = roomGroupOf(room.name);
    const key = roomGroupKey(group);
    if (!grouped.has(key)) grouped.set(key, { label: group.label, rooms: [] });
    grouped.get(key)!.rooms.push(room);
  }
  const plans = [...grouped].map(([key, group]) => ({ key, ...group }));
  const isLab = (name: string) => /(?:305|603)(?:호)?$|jj/i.test(name);
  // A lab takes two consecutive bays, keeping exactly twice the regular floor area.
  const roomRows = Math.max(3, ...plans.map((p) => Math.ceil(p.rooms.reduce((n, r) => n + (isLab(r.name) ? 2 : 1), 0) / 2)));
  const cellWidth = Math.max(22.4, roomRows * 6.3 + .4);
  const cellDepth = cellWidth;
  const roomWidth = (cellWidth - FLOOR_HALL_WIDTH - .4) / 2;
  const roomDepth = (cellDepth - .4) / roomRows;
  const floorColumns = stacked ? 1 : Math.min(2, plans.length);
  const floorRows = stacked ? 1 : Math.ceil(plans.length / floorColumns);
  const width = floorColumns * cellWidth + (floorColumns - 1) * FLOOR_GAP;
  const depth = floorRows * cellDepth + (floorRows - 1) * FLOOR_GAP;
  const placed: PlacedRoom[] = [];
  const floors = plans.map((plan, index): FloorPlate => {
    const x = stacked ? -cellWidth / 2 : (index % floorColumns) * (cellWidth + FLOOR_GAP) - width / 2;
    const z = stacked ? -cellDepth / 2 : Math.floor(index / floorColumns) * (cellDepth + FLOOR_GAP) - depth / 2;
    const y = stacked ? index * FLOOR_HEIGHT : 0;
    const used = [0, 0];
    // Place double bays first so a lab never spills through the exterior wall.
    [...plan.rooms].sort((a, b) => Number(isLab(b.name)) - Number(isLab(a.name))).forEach((room) => {
      const side = used[0] <= used[1] ? 0 : 1;
      const lab = isLab(room.name), bays = lab ? 2 : 1, depth = roomDepth * bays;
      placed.push({ id: room.id, label: room.name.replace(roomGroupOf(room.name).building, "") || room.name, floorKey: plan.key, y, lab,
        x: side === 0 ? x + .2 + roomWidth / 2 : x + cellWidth - .2 - roomWidth / 2,
        labelX: x + cellWidth / 2 + (side === 0 ? -1.65 : 1.65),
        z: z + .2 + depth / 2 + used[side] * roomDepth,
        width: roomWidth, depth, scaleX: depth / ROOM_WIDTH, scaleZ: roomWidth / ROOM_DEPTH,
        rotation: side === 0 ? Math.PI / 2 : -Math.PI / 2,
      });
      used[side] += bays;
    });
    return { key: plan.key, label: plan.label, x, y, z, width: cellWidth, depth: cellDepth, roomIds: plan.rooms.map((r) => r.id) };
  });
  return { rooms: placed, floors, width, height: stacked ? (plans.length - 1) * FLOOR_HEIGHT : 0, depth, stacked };
}

export function roomMapState(room: Classroom, minute: number | null) {
  const state = roomAt(room, minute);
  const status = minute === null ? "unknown" : state.active.length ? "ongoing" : state.next ? "next" : "idle";
  return { ...state, mapStatus: status, color: MAP_COLORS[status] };
}
