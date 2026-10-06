/**
 * ECS 오늘 **카드 모드**(반 하나 = 학생 한 줄) 로스터에 수업 나누기(0351a)를 얹는다 — 순수(Vitest).
 *
 * 카드는 교시별 행이 아니라 **반 단위 한 줄**이라 교시 단위 시트(`split-roster.ts`)와 규칙을 이렇게 접는다:
 *  - 받는 반 — 카드 교시 중 하나라도 나눔 시간과 겹치면 학생 행을 **추가**한다(이미 있으면 표식만).
 *  - 원래 반 — 나눔이 카드의 **모든 교시**를 덮고 그날 기록이 없으면 행을 **뺀다**(그날 이 반엔 안 온다).
 *    일부 교시만 덮으면 행은 남기고 표식(`→ 유형숙 …`)만 붙인다(나머지 시간은 여기서 수업한다).
 * 판정 재료(활성·겹침·문장)는 `@/features/class-splits/attendance` 단일 소스.
 */
import { splitDayOf, splitRowNote, visitOverlapsSlot, type SplitVisit } from "@/features/class-splits/attendance";
import type { ClassSplit } from "@/features/class-splits/rules";

type Names = ReadonlyMap<string, { name: string; teacherName: string | null }>;
type Slot = { start: string; end: string | null };

/** 받는 반으로 들어오는 학생 id(오늘 반들 전체) — 학생 메타 조회에 미리 넣는다. */
export function splitIncomingIds(classIds: readonly string[], date: string, splits: readonly ClassSplit[]): string[] {
  const out = new Set<string>();
  for (const id of classIds) for (const v of splitDayOf(id, date, splits).incoming) out.add(v.studentId);
  return [...out];
}

const overlapsAny = (v: SplitVisit, slots: readonly Slot[]) => slots.some((s) => visitOverlapsSlot(v, s.start, s.end));
const coversAll = (v: SplitVisit, slots: readonly Slot[]) =>
  slots.length > 0 && slots.every((s) => visitOverlapsSlot(v, s.start, s.end));

export function applySplitsToCard<T extends { studentId: string; name: string; split?: { dir: "in" | "out"; note: string } }>(args: {
  classId: string;
  date: string;
  slots: readonly Slot[];
  students: readonly T[];
  splits: readonly ClassSplit[];
  names: Names;
  /** 그날 이 반에 이 학생 기록(출결·태도)이 있나 — 있으면 원래 반에서 지우지 않는다. */
  hasRecord: (studentId: string) => boolean;
  /** 받는 반에 새로 세울 행 — 호출부가 메타·출결로 만든다. */
  makeRow: (studentId: string) => T;
}): T[] {
  const day = splitDayOf(args.classId, args.date, args.splits);
  if (day.incoming.length === 0 && day.outgoing.length === 0) return [...args.students];
  const out: T[] = [];
  for (const s of args.students) {
    const v = day.outgoing.find((x) => x.studentId === s.studentId && overlapsAny(x, args.slots));
    if (!v) {
      out.push(s);
      continue;
    }
    if (coversAll(v, args.slots) && !args.hasRecord(s.studentId)) continue;
    out.push({ ...s, split: { dir: "out", note: splitRowNote("out", v, args.names.get(v.otherClassId)) } });
  }
  const have = new Map(out.map((s, i) => [s.studentId, i]));
  const added: T[] = [];
  for (const v of day.incoming) {
    if (!overlapsAny(v, args.slots)) continue;
    const split = { dir: "in" as const, note: splitRowNote("in", v, args.names.get(v.otherClassId)) };
    const i = have.get(v.studentId);
    if (i !== undefined) {
      out[i] = { ...out[i]!, split };
      continue;
    }
    if (added.some((a) => a.studentId === v.studentId)) continue;
    added.push({ ...args.makeRow(v.studentId), split });
  }
  added.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return [...out, ...added];
}
