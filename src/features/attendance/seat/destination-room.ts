/**
 * 배치 한 줄의 **강의실** — 다음 행선지("16:20 본원205 이동")와 학생 축([`student-classes.ts`](./student-classes.ts))이
 * 함께 쓰는 순수 규칙(IO 없음, Vitest). 조회([`server/next-destination-day.ts`](./server/next-destination-day.ts))가
 * 받은 원문을 그대로 넘기면 여기서 정규화·상속한다.
 *
 * 순서 = **배치 FK 이름 → 배치 라벨(등록된 정본으로 정규화, [[#115]]) → 반 기본 강의실** — 시간표·학생 상세가 쓰는
 * 상속 규칙(슬롯 방 우선, 없으면 반 기본 강의실)과 같다.
 *
 * 원장 2026-09-11 *"이도윤B는 왜 금요일 랩실 끝나고 1620 다음수업이라고만 되어있지? 강의실이 없고?"* — 실측
 * (injaewon 2026-09-11 유효 배치): 수학 246줄 중 245줄이 배치 FK·라벨 둘 다 비어 있고 방은 **반 기본 강의실**에만
 * 있다(이도윤B 금 16:20 `초등M 초4 EL2S` → 반 기본 `본원205`). 종전엔 배치만 봐서 "16:20 다음 수업"이 됐다.
 */
import { canonicalRoomName } from "@/features/attendance/live/seating-floors";
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** 배치 한 줄의 강의실 **원문** — 조회가 받은 그대로 넘긴다. */
export type DestinationRoomSource = {
  /** 배치 FK(`class_schedules.classroom_id`)의 강의실 이름 — 등록된 정본. */
  slotRoom: string | null;
  /** 시트가 넣은 배치 라벨(`slot_room_label`) — `302`처럼 건물명이 없을 수 있다. */
  roomLabel: string | null;
  /** 반 기본 강의실(`classes.classroom_id`)의 이름. */
  classRoom: string | null;
  /** 자리(LAB·JJ) 배치면 그 라벨(`specialSlotLabel`), 사람이 가르치는 수업이면 null. */
  seatLabel: SpecialSlotLabel | null;
};

/**
 * 🔴 **자리(LAB·JJ) 배치는 반 기본 강의실을 물려받지 않는다** — 자리는 그 자체가 방(`SEAT_ROOM`)이고, 반 기본
 *    강의실은 그 반의 방이다(PL1b는 기본 `본원603`인데 금 14:20 수업은 `본원606`). 물려받으면 지어낸 방으로 아이를
 *    보낸다. 제 방이 없는 자리 배치는 시각만 남는다(실측: 유효 자리 배치 118줄은 전부 제 방이 있어 지금은 차이 0).
 * ⚠️ 빈 문자열은 없는 것으로 친다(`canonicalRoomName`이 공백을 null로 접는다) — 빈 FK 이름이 라벨을 가리지 않게.
 * ⚠️ 애매한 라벨(`602` = 바른602·본원602)은 라벨 그대로 남는다 — 배치에 적힌 방이 있으니 반 기본 강의실로 넘어가지 않는다.
 */
export function destinationRoomOf(src: DestinationRoomSource, knownRooms: readonly string[]): string | null {
  const own = canonicalRoomName(src.slotRoom, knownRooms) ?? canonicalRoomName(src.roomLabel, knownRooms);
  if (own) return own;
  if (src.seatLabel) return null;
  return canonicalRoomName(src.classRoom, knownRooms);
}
