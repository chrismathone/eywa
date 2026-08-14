/**
 * 랩실·JJ실 — 교시 가로줄로 묶는다(순수, Vitest).
 *
 * 일반 강의실은 하루 4교시·한 칸에 반 하나라 4열이 맞다.
 * 랩실은 같은 시각에 반이 5개까지 겹친다(목 시트). 하루를 4열에 펼치면
 * 15장이 한 덩어리로 쌓이고, 지금 교시가 어디인지도 안 보인다.
 * 시트와 같이 **시각 한 줄 + 그 시각의 병렬 반**으로 가른다.
 *
 * 호수는 자리의 정체다 — LAB=603(본원 6층), JJ=305(본원 3층). 방 라벨이
 * 「랩실」만 있어도 이 호수로 층을 잡는다.
 */
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import type { SeatingClass } from "./seating";

export const SEAT_ROOM_META: Record<
  SpecialSlotLabel,
  { roomName: string; floorRoom: string }
> = {
  LAB: { roomName: "랩실(603호)", floorRoom: "본원603" },
  JJ: { roomName: "JJ실(305호)", floorRoom: "본원305" },
};

export type SeatPeriodBand = {
  start: string;
  end: string | null;
  classes: SeatingClass[];
};

export function isSeatRoom(room: { roomName: string; classes: readonly SeatingClass[] }): boolean {
  if (room.classes.some((c) => c.seatLabel != null)) return true;
  return /랩실|JJ실/i.test(room.roomName);
}

export function groupSeatPeriods(classes: readonly SeatingClass[]): SeatPeriodBand[] {
  const byStart = new Map<string, SeatingClass[]>();
  for (const c of classes) {
    const list = byStart.get(c.firstStart);
    if (list) list.push(c);
    else byStart.set(c.firstStart, [c]);
  }
  return [...byStart.keys()]
    .sort((a, b) => (a < b ? -1 : 1))
    .map((start) => {
      const list = byStart.get(start) ?? [];
      let end: string | null = null;
      for (const c of list) {
        if (c.firstEnd && (end == null || c.firstEnd > end)) end = c.firstEnd;
      }
      return { start, end, classes: list };
    });
}
