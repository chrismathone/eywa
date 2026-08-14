/**
 * 직원 '자리 출석부 담당' — 순수 판정(IO 없음, Vitest).
 *
 * 토글은 랩실·JJ실을 각각 켠다. 착지는 **화면이 열린 자리**(USABLE_SEAT_KEYS).
 * 자리 시수(OPEN)와 별개라 JJ 담당도 로그인 착지가 305 출석부로 간다.
 */
import { USABLE_SEAT_KEYS, type SeatKey } from "./seat";

export type SeatDuties = Record<SeatKey, boolean>;

export const EMPTY_SEAT_DUTIES: SeatDuties = { lab: false, jj: false };

/** 로그인 착지 — 열린 자리 중 담당인 첫 곳. 없으면 null(기존 강사/역할 홈). */
export function landingPathFromDuties(duties: SeatDuties): string | null {
  for (const seat of USABLE_SEAT_KEYS) {
    if (duties[seat]) return `/attendance/seat/${seat}`;
  }
  return null;
}

/** 이 자리 화면·쓰기를 토글만으로 열 수 있나. */
export function dutyAllowsSeat(duties: SeatDuties, seat: SeatKey): boolean {
  return (USABLE_SEAT_KEYS as readonly string[]).includes(seat) && duties[seat] === true;
}
