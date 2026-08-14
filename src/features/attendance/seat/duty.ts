/**
 * 직원 '자리 출석부 담당' — 순수 판정(IO 없음, Vitest).
 *
 * 토글은 랩실·JJ실을 각각 켠다. 착지는 **지금 열려 있는 자리**만(OPEN_SEAT_KEYS).
 * JJ실 토글을 미리 켜 둬도, 자리 화면이 열리기 전에는 착지·쓰기가 생기지 않는다
 * (시수 귀속 결정이 나기 전에 급여가 움직이는 것을 막으려고).
 */
import { OPEN_SEAT_KEYS, type SeatKey } from "./seat";

export type SeatDuties = Record<SeatKey, boolean>;

export const EMPTY_SEAT_DUTIES: SeatDuties = { lab: false, jj: false };

/** 로그인 착지 — 열린 자리 중 담당인 첫 곳. 없으면 null(기존 강사/역할 홈). */
export function landingPathFromDuties(duties: SeatDuties): string | null {
  for (const seat of OPEN_SEAT_KEYS) {
    if (duties[seat]) return `/attendance/seat/${seat}`;
  }
  return null;
}

/** 이 자리 화면·쓰기를 토글만으로 열 수 있나. 안 연 자리는 false. */
export function dutyAllowsSeat(duties: SeatDuties, seat: SeatKey): boolean {
  return (OPEN_SEAT_KEYS as readonly string[]).includes(seat) && duties[seat] === true;
}
