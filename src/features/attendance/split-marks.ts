/**
 * 월별 출석부의 **수업 나누기(0351a) 칸 표식** — 순수. 반 하나 × 기간의 나눔을 학생 → 날짜 → 표식으로 편다.
 *
 * 🔴 값(marks/units)이 아니다 — 시수·출석률·합계 어디에도 안 들어간다(보강 예약 칸과 같은 결).
 * 🔴 받는 반(in) 학생은 수강행이 없어도 명단에 서야 한다(그 시간 출결이 이 반 몫) — 그 id 목록도 여기서 낸다.
 */
import type { ClassSplit } from "@/features/class-splits/rules";
import { splitDayOf, splitRowNote } from "@/features/class-splits/attendance";

export type SplitDateMark = { dir: "in" | "out"; note: string };

export function splitDateMarks(
  classId: string,
  dates: readonly string[],
  splits: readonly ClassSplit[],
  classNames: ReadonlyMap<string, { name: string; teacherName: string | null }>,
): { marks: Record<string, Record<string, SplitDateMark>>; incomingIds: string[] } {
  const marks: Record<string, Record<string, SplitDateMark>> = {};
  const incoming = new Set<string>();
  if (splits.length === 0) return { marks, incomingIds: [] };
  for (const date of dates) {
    const day = splitDayOf(classId, date, splits);
    // 받는 쪽을 먼저 — 같은 날 같은 학생이 양쪽이면(드묾) 이 반에 와서 하는 쪽이 칸의 뜻이다.
    for (const [dir, list] of [["in", day.incoming], ["out", day.outgoing]] as const) {
      for (const v of list) {
        if (dir === "in") incoming.add(v.studentId);
        const row = (marks[v.studentId] ??= {});
        if (row[date]) continue;
        row[date] = { dir, note: splitRowNote(dir, v, classNames.get(v.otherClassId)) };
      }
    }
  }
  return { marks, incomingIds: [...incoming] };
}
