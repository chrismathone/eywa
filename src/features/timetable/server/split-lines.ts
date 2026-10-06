import "server-only";

/**
 * 기본뷰의 **'나눔' 표시**(수업 나누기 0351a) — 원래 반 칸엔 `→받는 선생님`, 받는 반 칸엔 `←원래 선생님`.
 * 원장 2026-10-06 *"시간표에서도 해당 학생들이 이동되면 모두 보여야 함"* · *"자기 수업에 1시간 떼져 있고 나눈 선생님 시간표에도 표시"*.
 *
 * 🔴 표시 전용 — `students`(수강 명단)에 섞지 않는다(인원·드래그·엑셀·반 이동 판정이 그 배열을 센다).
 * 🔴 반 집합 = **화면에 선 슬롯의 반**(강사 스코프·과목 필터 뒤) — 나눔 표를 따로 스코핑하지 않는다(#77).
 * 🔴 fail-soft — 조회 실패·표 미적용이면 슬롯을 그대로 돌려준다(시간표는 hot path, [[#95]]).
 */
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getSplitsTouchingClasses } from "@/features/class-splits/server/queries";
import { splitActiveOn } from "@/features/class-splits/period";
import { splitLinesForCell, type TimetableSplitLine } from "@/features/class-splits/lines";
import type { ClassSplit } from "@/features/class-splits/rules";
import { dateOfDowInWeek, mondayOf, shiftDays } from "../lib/week";

type SlotLike = { classId: string; dayOfWeek: string; startTime: string; endTime: string };

export type SplitAttachResult<T> = {
  slots: T[];
  /** 그 주에 살아 있는 나눔(툴바 목록용) — 한 줄 = 한 나눔. */
  active: TimetableSplitLine[];
};

export async function attachSplitLines<T extends SlotLike>(
  slots: readonly T[],
  referenceDate: string,
): Promise<SplitAttachResult<T & { splits?: TimetableSplitLine[] }>> {
  const classIds = [...new Set(slots.map((s) => s.classId).filter(Boolean))];
  if (classIds.length === 0) return { slots: [...slots], active: [] };
  const monday = mondayOf(referenceDate);
  const splits = await getSplitsTouchingClasses(classIds, monday, shiftDays(monday, 6));
  if (splits.length === 0) return { slots: [...slots], active: [] };

  const sb = await createClient();
  const studentIds = [...new Set(splits.map((s) => s.studentId))];
  const otherIds = [...new Set(splits.flatMap((s) => [s.sourceClassId, s.targetClassId]))];
  type Stu = { id: string; name: string; grade: string | null; school: string | null };
  type Cls = { id: string; class_name: string; teacher?: { display_name?: string } | { display_name?: string }[] | null };
  const [students, classes] = await Promise.all([
    fetchInChunks<Stu>(studentIds, (c) => sb.from("students").select("id, name, grade, school").in("id", c)).catch(() => [] as Stu[]),
    fetchInChunks<Cls>(otherIds, (c) =>
      sb.from("classes").select("id, class_name, teacher:teacher_id ( display_name )").in("id", c),
    ).catch(() => [] as Cls[]),
  ]);
  const stuById = new Map(students.map((s) => [s.id, s]));
  const clsById = new Map(
    classes.map((c) => {
      const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
      return [c.id, { name: c.class_name, teacherName: t?.display_name ?? null }];
    }),
  );
  const names = { student: (id: string) => stuById.get(id), klass: (id: string) => clsById.get(id) };

  const activeOn = (s: ClassSplit, day: string) => {
    const date = dateOfDowInWeek(referenceDate, day);
    return !!date && splitActiveOn(s, date);
  };
  const withLines = slots.map((s) => {
    const live = splits.filter((x) => activeOn(x, s.dayOfWeek));
    const lines = splitLinesForCell(s, live, names);
    return lines.length > 0 ? { ...s, splits: lines } : s;
  });

  // 툴바 목록 — 나눔마다 한 줄(받는 쪽 기준이면 원래 선생님 이름이 꼬리표라 '어디로'가 안 보이므로 out 방향으로 만든다).
  const active: TimetableSplitLine[] = [];
  for (const s of splits) {
    if (!activeOn(s, s.dayOfWeek)) continue;
    const [line] = splitLinesForCell(
      { classId: s.sourceClassId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime },
      [s],
      names,
    );
    if (line) active.push(line);
  }
  return { slots: withLines, active };
}
