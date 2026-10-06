// 격자 변경(GridDelta) + 지금 DB 상태 → 화면에 보여 줄 미리보기. 순수.
//
// 여기서 하는 일은 셋이다: ① 처음 보는 학생 글자를 학생 명부에서 찾고 ② 이미 그렇게 돼 있는 변경(시트를 보낸 뒤
// 앱에서 먼저 옮긴 것)을 걸러 내고 ③ 교시를 사람이 읽는 시각으로 바꾼다. 쓰기는 하지 않는다.

import { formatSchoolGrade } from "@/lib/format/school-grade";
import type { PeriodTime } from "@/features/timetable/lib/periods";
import { norm } from "../match";
import { LEGACY_PERIOD_IDS, studentNameOf } from "./grid-text";
import type { DeltaClassRef, DeltaSlot, DeltaStudent, GridDelta } from "./types";

export interface PreviewContext {
  /** 수학 반 전부(종강 포함) — 새 반 이름이 종강 반과 겹치는지 본다. */
  classes: { id: string; name: string; active: boolean }[];
  students: { id: string; name: string; school: string | null; grade: string | null; status: string | null }[];
  teacherNames: string[];
  roomNames: string[];
  /** `${studentId}:${classId}` — 지금 수강 중(종료 안 됨). */
  enrolled: Set<string>;
  periods: { weekday: Record<string, PeriodTime>; weekend: Record<string, PeriodTime> };
}

/** ok = 누구인지 확정 · unknown = 학생 명부에 없음 · ambiguous = 같은 이름이 여럿 */
export type StudentState = "ok" | "unknown" | "ambiguous";

export interface PreviewSlot {
  teacher: string;
  teacherKnown: boolean;
  /** "수 16:20~18:10 (2교시)" */
  when: string;
  room: string;
  roomKnown: boolean;
}

export interface MathGridPreview {
  tabName: string;
  newClasses: { name: string; slots: PreviewSlot[]; students: { label: string; state: StudentState }[]; clash: boolean }[];
  placedClasses: { name: string; slots: PreviewSlot[] }[];
  moves: { student: string; from: string; to: string; toNew: boolean }[];
  adds: { student: string; to: string; toNew: boolean; state: StudentState }[];
  removes: { student: string; from: string }[];
  notes: string[];
  warnings: string[];
  stats: { classCells: number; students: number };
}

const hm = (t: string) => (t ?? "").slice(0, 5);

/** 레거시 교시 id들 → "16:20~18:10 (2교시)". 학원 교시표에 그 교시가 없으면 시각 없이 "2교시"만 적는다. */
export function slotTimeText(slot: DeltaSlot, periods: PreviewContext["periods"]): string {
  const table = slot.weekend ? periods.weekend : periods.weekday;
  const ids = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const idx = slot.periodIds.map((p) => LEGACY_PERIOD_IDS.indexOf(p)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (idx.length === 0) return "교시를 읽지 못함";
  const gid = Math.floor(idx[0]! / 2) + 1;
  const whole = idx.length === 2 && idx[0]! % 2 === 0 && idx[1] === idx[0]! + 1;
  const label = whole ? `${gid}교시` : idx.length === 1 ? `${gid}교시 ${idx[0]! % 2 === 0 ? "앞" : "뒤"} 시간` : "";
  const first = table[String(ids[idx[0]!])];
  const last = table[String(ids[idx[idx.length - 1]!])];
  if (!first || !last) return label || `${gid}교시부터 ${idx.length}시간`;
  const range = `${hm(first.startTime)}~${hm(last.endTime)}`;
  return slot.weekend || !label ? range : `${range} (${label})`;
}

export function buildMathGridPreview(delta: GridDelta, ctx: PreviewContext, tabName: string): MathGridPreview {
  const notes = [...delta.notes];
  const teachers = new Set(ctx.teacherNames.map(norm));
  const rooms = new Set(ctx.roomNames.map(norm));
  const inactiveNames = new Set(ctx.classes.filter((c) => !c.active).map((c) => norm(c.name)));

  const slotOf = (s: DeltaSlot): PreviewSlot => ({
    teacher: s.teacher,
    teacherKnown: teachers.has(norm(s.teacher)),
    when: `${s.days.join("·")} ${slotTimeText(s, ctx.periods)}`,
    room: s.room,
    roomKnown: !s.room || rooms.has(norm(s.room)),
  });

  /**
   * 시트가 모르던 글자 → 학생 명부. 글자 전체(이름/학년학교)가 맞는 학생만 그 학생으로 본다.
   * 🔴 학교·학년까지 적었는데 글자가 다르면 **이름만으로 잇지 않는다** — 같은 이름의 다른 아이를 기존 학생에
   *    붙이면 "이미 수강 중"으로 조용히 사라지거나 엉뚱한 아이가 반에 들어간다([[#132]] 동명이인).
   *    이름만 적은 글자(빗금 없음)는 재원생 중 그 이름이 한 명일 때만 잇는다.
   */
  const resolve = (s: DeltaStudent): { id: string | null; state: StudentState } => {
    if (s.studentId) return { id: s.studentId, state: "ok" };
    const exact = ctx.students.filter((x) => `${x.name}/${formatSchoolGrade(x.school, x.grade)}` === s.text);
    if (exact.length === 1) return { id: exact[0]!.id, state: "ok" };
    if (exact.length > 1) return { id: null, state: "ambiguous" };
    if (s.text.includes("/")) return { id: null, state: "unknown" };
    const name = norm(studentNameOf(s.text));
    const byName = ctx.students.filter((x) => norm(x.name) === name && x.status !== "withdrawn");
    if (byName.length === 1) return { id: byName[0]!.id, state: "ok" };
    return { id: null, state: byName.length > 1 ? "ambiguous" : "unknown" };
  };
  const isIn = (studentId: string | null, cls: DeltaClassRef) =>
    !!studentId && !!cls.classId && ctx.enrolled.has(`${studentId}:${cls.classId}`);

  const moves: MathGridPreview["moves"] = [];
  const adds: MathGridPreview["adds"] = [];
  const removes: MathGridPreview["removes"] = [];
  const pushAdd = (student: DeltaStudent, to: DeltaClassRef) => {
    const { id, state } = resolve(student);
    if (isIn(id, to)) notes.push(`${student.text} — 이미 "${to.name}" 수강 중이라 추가에서 뺐습니다.`);
    else adds.push({ student: student.text, to: to.name, toNew: !to.classId, state });
  };
  const pushRemove = (student: DeltaStudent, from: DeltaClassRef) => {
    if (isIn(student.studentId, from)) removes.push({ student: student.text, from: from.name });
    else notes.push(`${student.text} — 이미 "${from.name}"에서 빠져 있어 그대로 둡니다.`);
  };

  for (const m of delta.moves) {
    const leaving = isIn(m.student.studentId, m.from);
    const arrived = isIn(m.student.studentId, m.to);
    if (leaving && !arrived) {
      moves.push({ student: m.student.text, from: m.from.name, to: m.to.name, toNew: !m.to.classId });
    } else {
      // 시트를 보낸 뒤 앱에서 한쪽이 먼저 바뀌었다 — 남은 쪽만 따로 보인다.
      pushRemove(m.student, m.from);
      pushAdd(m.student, m.to);
    }
  }
  for (const a of delta.adds) pushAdd(a.student, a.to);
  for (const r of delta.removes) pushRemove(r.student, r.from);

  return {
    tabName,
    newClasses: delta.newClasses.map((n) => ({
      name: n.name,
      slots: n.slots.map(slotOf),
      students: n.students.map((s) => ({ label: s.text, state: resolve(s).state })),
      clash: inactiveNames.has(norm(n.name)),
    })),
    placedClasses: delta.placedClasses.map((p) => ({ name: p.name, slots: p.slots.map(slotOf) })),
    moves,
    adds,
    removes,
    notes,
    warnings: delta.warnings,
    stats: delta.stats,
  };
}
