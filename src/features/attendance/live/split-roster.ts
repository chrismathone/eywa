/**
 * 오늘 출결(교시 단위) 명단에 **수업 나누기**(0351a)를 얹는 순수 규칙 — `load.ts`가 교시마다 부른다.
 *
 *  - 받는 반의 겹치는 교시: 나눔 학생을 **더한다**(수강행 없이 — 보강 예약과 같은 결). 출결은 이 반에 찍혀
 *    강사 귀속이 받는 선생님이 된다(원장 2026-10-06 *"출결은 맡아진 시간에는 그 선생님 몫"*).
 *  - 원래 반의 겹치는 교시: 그 학생을 **뺀다**(그 시간엔 다른 반에 있다 — 두 반에서 찍히면 이중 출결이다).
 *    🔴 단 그 교시에 **이미 기록이 있으면 남긴다**(있는 데이터를 감추지 않는다) — 표식으로 사정을 알린다.
 *  - 겹치지 않는 교시는 손대지 않는다(나머지 시간은 원래 반 수업이다).
 */
import {
  incomingInSlot,
  outgoingStudentIdsInSlot,
  splitRowNote,
  type ClassSplitDay,
  type SplitVisit,
} from "@/features/class-splits/attendance";

export type LiveSplitMark = { dir: "in" | "out"; note: string };

export function applySplitsToSlotRoster(args: {
  expected: ReadonlySet<string>;
  slotStart: string;
  slotEnd: string | null;
  day: ClassSplitDay | undefined;
  /** 그 학생이 **이 교시**에 이미 기록이 있나(교시별 기록만 — 그날 전체 기록은 다른 교시에도 보인다). */
  hasSlotRecord: (studentId: string) => boolean;
  /** 상대 반 이름·담임(표식 문장). 모르면 undefined → "다른 반". */
  classInfo: (classId: string) => { name: string; teacherName: string | null } | undefined;
}): { expected: Set<string>; marks: Map<string, LiveSplitMark> } {
  const expected = new Set(args.expected);
  const marks = new Map<string, LiveSplitMark>();
  if (!args.day) return { expected, marks };
  const note = (dir: "in" | "out", v: SplitVisit) => splitRowNote(dir, v, args.classInfo(v.otherClassId));

  const outIds = outgoingStudentIdsInSlot(args.day, args.slotStart, args.slotEnd);
  for (const v of args.day.outgoing) {
    if (!outIds.has(v.studentId) || !expected.has(v.studentId)) continue;
    if (args.hasSlotRecord(v.studentId)) marks.set(v.studentId, { dir: "out", note: note("out", v) });
    else expected.delete(v.studentId);
  }
  for (const v of incomingInSlot(args.day, args.slotStart, args.slotEnd)) {
    expected.add(v.studentId);
    marks.set(v.studentId, { dir: "in", note: note("in", v) });
  }
  return { expected, marks };
}
