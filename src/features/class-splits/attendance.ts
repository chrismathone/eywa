/**
 * 수업 나누기(0351a) → **출석부 규약** 단일 소스(순수). 원장 2026-10-06 *"출결은 맡아진 시간에는 그 선생님 몫"*.
 *
 * 한 날짜·한 반 기준으로 나눔은 두 갈래다.
 *  - **incoming**(받는 반) — 그 시간 이 반 출석부에 **미리 선다**(수강행 없이, 보강 예약 0264a와 같은 결).
 *    출결은 이 반에 찍히므로 강사 귀속(teacher-axis)은 자동으로 받는 반 선생님이다.
 *  - **outgoing**(원래 반) — 학생은 원래 반 명단에 **그대로 남고**(나머지 시간은 여기서 수업한다) 그 시간만 표식이 붙는다.
 *    🔴 교시 단위 출석부(오늘 출결·ECS)에선 **겹치는 교시에서 빠진다** — 두 반에서 같은 시간 출결이 찍히면 이중이다.
 *
 * 🔴 수강이 아니다 — 인원·청구·재원 집계에 섞지 말 것(수강료는 원래 반 기준).
 * ⚠️ 클라도 import할 수 있게 `server-only` 금지([[#61]]).
 */
import { toMin, type ClassSplit } from "./rules";
import { splitActiveOn } from "./period";

export type SplitVisit = {
  splitId: string;
  studentId: string;
  /** 상대 반(incoming이면 원래 반, outgoing이면 받는 반) */
  otherClassId: string;
  /** "HH:MM" */
  startTime: string;
  endTime: string;
};

export type ClassSplitDay = { incoming: SplitVisit[]; outgoing: SplitVisit[] };

const EMPTY: ClassSplitDay = { incoming: [], outgoing: [] };

/** 그 반·그 날짜의 나눔 두 갈래. 날짜에 살아 있지 않은 나눔은 버린다. */
export function splitDayOf(classId: string, date: string, splits: readonly ClassSplit[]): ClassSplitDay {
  const out: ClassSplitDay = { incoming: [], outgoing: [] };
  for (const s of splits) {
    if (!splitActiveOn(s, date)) continue;
    const v = (other: string): SplitVisit => ({
      splitId: s.id,
      studentId: s.studentId,
      otherClassId: other,
      startTime: s.startTime,
      endTime: s.endTime,
    });
    if (s.targetClassId === classId) out.incoming.push(v(s.sourceClassId));
    else if (s.sourceClassId === classId) out.outgoing.push(v(s.targetClassId));
  }
  return out.incoming.length || out.outgoing.length ? out : EMPTY;
}

/** 교시(시각 구간)와 나눔 시간이 겹치나. 교시 시각을 모르면(null) 겹친다고 보지 **않는다**(지우는 쪽으로 실패하지 않게). */
export function visitOverlapsSlot(v: Pick<SplitVisit, "startTime" | "endTime">, slotStart: string | null, slotEnd: string | null): boolean {
  if (!slotStart || !slotEnd) return false;
  const a = toMin(slotStart);
  const b = toMin(slotEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return toMin(v.startTime) < b && a < toMin(v.endTime);
}

/** 이 교시에 원래 반에서 **빠지는** 학생 id(교시 단위 출석부가 명단에서 뺀다). */
export function outgoingStudentIdsInSlot(day: ClassSplitDay, slotStart: string | null, slotEnd: string | null): Set<string> {
  return new Set(day.outgoing.filter((v) => visitOverlapsSlot(v, slotStart, slotEnd)).map((v) => v.studentId));
}

/** 이 교시에 받는 반으로 **오는** 학생들(교시 단위 출석부). */
export function incomingInSlot(day: ClassSplitDay, slotStart: string | null, slotEnd: string | null): SplitVisit[] {
  return day.incoming.filter((v) => visitOverlapsSlot(v, slotStart, slotEnd));
}

/**
 * 출석부 행 표식 문장 — 원래 반 `17:20~18:20 → 유형숙(중1 개별)` / 받는 반 `나눔 17:20~18:20 ← 이성우(중1 수학)`.
 * 이름을 모르면 반 id를 내보내지 않고 `다른 반`으로 쓴다(raw 코드 노출 금지).
 */
export function splitRowNote(dir: "in" | "out", v: SplitVisit, other: { name: string; teacherName: string | null } | undefined): string {
  const who = other ? (other.teacherName?.trim() ? `${other.teacherName.trim()}(${other.name})` : other.name) : "다른 반";
  return dir === "out" ? `${v.startTime}~${v.endTime} → ${who}` : `나눔 ${v.startTime}~${v.endTime} ← ${who}`;
}
