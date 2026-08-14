/**
 * 305/JJ **방 하루** 조립 — 순수. 서버 조회와 화면이 같은 묶음·키를 쓴다.
 *
 * 반 카드 ECS는 축이 반이라 같은 시각 2~3반이 305에 앉아도 표가 갈라진다.
 * 여기는 **자리(JJ) × 시작시각 × 합명단**. 저장 키는 (반, 학생, 날짜, slot_start).
 *
 * 🔴 필터 키는 `specialSlotLabel`뿐이다.
 * 🔴 표시 묶음은 **시작시각만**(자리 출석부 `groupByStart`와 같음). 16:20–17:00과 16:20–17:20은
 *    같은 방에 같이 있으므로 한 표. 저장은 slot_start라 종료가 달라도 이중 행이 안 생긴다.
 */
import {
  SELF_STUDY_ROOM_LABEL,
  specialSlotLabel,
  type SpecialSlotLabel,
} from "@/features/timetable/lib/teacher-label";
import { normalizeSlotTime } from "./week";

export type SeatSlotRef = {
  classId: string;
  className: string;
  startTime: string;
  endTime: string | null;
  slotTeacherLabel: string | null;
};

export type SeatBucket<T> = {
  slotStart: string;
  /** 그 시각의 가장 늦은 종료 — 교시 라벨용. */
  slotEnd: string | null;
  ends: string[];
  items: T[];
};

export function isSeatLabel(
  label: string | null | undefined,
  seat: SpecialSlotLabel,
): boolean {
  return specialSlotLabel(label) === seat;
}

export function isJjSeatLabel(label: string | null | undefined): boolean {
  return isSeatLabel(label, SELF_STUDY_ROOM_LABEL);
}

export function groupSeatSlots<T extends { startTime: string; endTime: string | null }>(
  slots: readonly T[],
): SeatBucket<T>[] {
  const map = new Map<string, T[]>();
  for (const s of slots) {
    const start = normalizeSlotTime(s.startTime);
    const arr = map.get(start) ?? [];
    arr.push(s);
    map.set(start, arr);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slotStart, items]) => {
      const ends = [
        ...new Set(items.map((i) => (i.endTime ? normalizeSlotTime(i.endTime) : "")).filter(Boolean)),
      ].sort();
      return { slotStart, slotEnd: ends[ends.length - 1] ?? null, ends, items };
    });
}

/** 쓰기는 반이 진실 — 같은 학생이 두 반에 있으면 행이 둘. */
export function seatRowKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

export function seatAttKey(classId: string, studentId: string, slotStart: string): string {
  return `${classId}|${studentId}|${normalizeSlotTime(slotStart)}`;
}

/** 표시용 반 이름 — `중등E_초등 브릿지 A` → `초등 브릿지 A`. 접두가 없으면 원문. */
export function shortClassLabel(className: string): string {
  const cut = className.indexOf("_");
  return cut >= 0 && cut < className.length - 1 ? className.slice(cut + 1) : className;
}

export function classNamesOf(items: readonly { className: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (seen.has(it.className)) continue;
    seen.add(it.className);
    out.push(it.className);
  }
  return out;
}
