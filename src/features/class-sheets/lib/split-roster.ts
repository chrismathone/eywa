/**
 * ECS 주간·오늘 시트 로스터에 **수업 나누기**(0351a)를 얹는다 — 순수(Vitest).
 * 원장 2026-10-06 *"출결은 맡아진 시간에는 그 선생님 몫"*.
 *
 * 교시 단위로 판정한다(규약 단일 소스 = `@/features/class-splits/attendance`):
 *  - **받는 반** — 나눔 시간과 겹치는 교시에 학생이 **입력 가능한 행**으로 선다(`eligible: true` + `split.dir="in"`).
 *  - **원래 반** — 겹치는 교시에서 학생을 **뺀다**(두 반에서 같은 시간 출결이 찍히면 이중이다).
 *    단 그 교시에 이미 기록(출결·태도)이 있으면 지우지 않고 `split.dir="out"` 표식만 붙여 남긴다(기록은 사실이다).
 *  - 겹치지 않는 교시는 그대로.
 * 🔴 수강이 아니다 — 인원·청구·재원 집계에 닿지 않는다(표시·입력 대상만 바뀐다).
 */
import {
  incomingInSlot,
  outgoingStudentIdsInSlot,
  splitDayOf,
  splitRowNote,
  type SplitVisit,
} from "@/features/class-splits/attendance";
import type { ClassSplit } from "@/features/class-splits/rules";
import type { RosterEntry, WeekGrid } from "./grid";

export type SplitClassNames = ReadonlyMap<string, { name: string; teacherName: string | null }>;

/** 그 교시(학생·날짜·교시)에 이미 기록이 있는가 — 원래 반에서 지우지 않을 근거. */
export type HasRecordAt = (studentId: string, date: string, slotStart: string) => boolean;

export function applySplitsToGrid(
  grid: WeekGrid,
  classId: string,
  splits: readonly ClassSplit[],
  names: SplitClassNames,
  hasRecordAt: HasRecordAt,
): WeekGrid {
  if (splits.length === 0) return grid;
  const days = grid.days.map((day) => {
    const sd = splitDayOf(classId, day.date, splits);
    if (sd.incoming.length === 0 && sd.outgoing.length === 0) return day;
    const slots = day.slots.map((slot) => {
      const outIds = outgoingStudentIdsInSlot(sd, slot.slotStart, slot.slotEnd);
      const outVisit = (id: string) => sd.outgoing.find((v) => v.studentId === id && outIds.has(id));
      const roster: RosterEntry[] = [];
      for (const e of slot.roster) {
        if (!outIds.has(e.studentId)) {
          roster.push(e);
          continue;
        }
        if (!hasRecordAt(e.studentId, day.date, slot.slotStart)) continue; // 그 시간엔 다른 반에서 수업
        const v = outVisit(e.studentId)!;
        roster.push({ ...e, split: { dir: "out", note: splitRowNote("out", v, names.get(v.otherClassId)) } });
      }
      const have = new Set(roster.map((e) => e.studentId));
      for (const v of incomingInSlot(sd, slot.slotStart, slot.slotEnd)) {
        if (have.has(v.studentId)) {
          // 이미 이 반 행이 있으면(수강생이거나 기록 보유) 표식만 얹는다 — 두 줄로 세우지 않는다.
          const i = roster.findIndex((e) => e.studentId === v.studentId);
          roster[i] = { ...roster[i]!, split: { dir: "in", note: inNote(v, names) } };
          continue;
        }
        roster.push({
          studentId: v.studentId,
          eligible: true,
          isMakeup: false,
          historical: false,
          endedOn: null,
          endedReason: null,
          endedContinuesIn: null,
          split: { dir: "in", note: inNote(v, names) },
        });
        have.add(v.studentId);
      }
      roster.sort((a, b) => a.studentId.localeCompare(b.studentId));
      return { ...slot, roster };
    });
    return { ...day, slots };
  });
  return { ...grid, days };
}

function inNote(v: SplitVisit, names: SplitClassNames): string {
  return splitRowNote("in", v, names.get(v.otherClassId));
}

/** 받는 반 학생 id들(그 주 어느 교시에든 들어오는) — 학생 메타 보충 조회용. */
export function incomingStudentIds(grid: WeekGrid): string[] {
  const out = new Set<string>();
  for (const d of grid.days) for (const s of d.slots) for (const e of s.roster) if (e.split?.dir === "in") out.add(e.studentId);
  return [...out];
}
