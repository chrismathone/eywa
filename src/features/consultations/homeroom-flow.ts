/**
 * 담임별 상담 현황의 **지난달 흐름** — 지난달 말 학생 수 · 지난달 퇴원 · 지난달 수강 종료(순수 · Vitest).
 *
 * 원장 2026-10-27 *"저번 달 학생 수 이번 달 학생 수 전달 퇴원생"* → 후속 *"윤채민은 이전 담임인 허은진일 때 퇴사했음 —
 * 수강 종료, 퇴원 당시에 담임으로 체크되어야 함"*.
 *
 * 🔑 **그 당시 담임**으로 센다 — 담임은 반 단위 값이라 지금 담임으로 세면 인수인계 전에 나간 학생이 새 담임 몫이 된다.
 *    날짜별 담임은 담임 변경 감사로그로 되살린 이력([`homeroomTeacherOnDate`](../classes/teacher-as-of.ts) — 출석부 시수와 같은 근거)이고,
 *    이력이 없으면 지금 담임이다(보고서 작성자 추정은 쓰지 않는다 — 작성자는 담임이 아니다, [[#93]]).
 * 🔑 **퇴원일 = 학생의 퇴원일(`students.withdrawn_at`)** — 수강 종료일이 하루 늦게 찍힌 행이 있다(실측: 윤채민 퇴원 8/31 · 수강 종료 9/1).
 *    수강 종료일로 세면 8월 퇴원이 9월로, 그리고 9/1부터 맡은 새 담임 앞으로 넘어간다.
 * 🔑 갈래 셋 — 퇴원(학생 상태 퇴원) / 수강 종료(학원은 다니는데 그 과목 수강이 오늘 하나도 없음) / 그 외(반이동·같은 과목 다른 반 = 안 셈).
 */
import { homeroomTeacherOnDate, type HomeroomPeriod } from "../classes/teacher-as-of";
import { lastDayOf, type HomeroomPrevFlow } from "./homeroom-model";

export type FlowInput = {
  prevMonth: string;
  /** 반 → 지금 담임·과목(지난달 이후 살아 있던 담임 상담 대상 반 전부). */
  classes: Map<string, { teacherId: string | null; subject: string | null }>;
  /** 반 → 담임 이력(감사로그). */
  homeroomHistory: ReadonlyMap<string, readonly HomeroomPeriod[]>;
  /** 지난달 1일 이후 끝났거나 아직 열린 수강. `live` = 오늘 살아 있음. */
  enrollments: { studentId: string; classId: string; startDate: string | null; endDate: string | null; isTransferred: boolean; live: boolean }[];
  /** 테스트가 아닌 학생. */
  students: Map<string, { name: string; withdrawn: boolean; withdrawnAt: string | null }>;
};

export function buildPrevMonthFlow(input: FlowInput): Map<string, HomeroomPrevFlow> {
  const prevLast = lastDayOf(input.prevMonth);
  const teacherOn = (classId: string, date: string) => {
    const cls = input.classes.get(classId);
    return cls ? homeroomTeacherOnDate(input.homeroomHistory.get(classId), cls.teacherId, date) : null;
  };
  // 오늘 그 과목 수강이 남아 있는 학생(과목별) — 끝난 수강이 '그 과목을 그만둠'인지 '다른 반으로 옮김'인지 가른다.
  const liveSubjects = new Map<string, Set<string>>();
  for (const e of input.enrollments) {
    const subject = input.classes.get(e.classId)?.subject;
    if (e.live && subject) liveSubjects.set(e.studentId, (liveSubjects.get(e.studentId) ?? new Set<string>()).add(subject));
  }

  const students = new Map<string, Set<string>>();
  const withdrawn = new Map<string, Map<string, string>>();
  const ended = new Map<string, Map<string, string>>();
  const add = (m: Map<string, Map<string, string>>, teacher: string, id: string, name: string) =>
    m.set(teacher, (m.get(teacher) ?? new Map<string, string>()).set(id, name));

  for (const e of input.enrollments) {
    const st = input.students.get(e.studentId);
    const cls = input.classes.get(e.classId);
    if (!st || !cls) continue;
    // 실제로 나간 날 — 퇴원생은 학생 퇴원일이 수강 종료일보다 앞서면 그 날(늦게 찍힌 종료일에 끌려가지 않게).
    const leftOn = st.withdrawn && st.withdrawnAt && e.endDate && st.withdrawnAt < e.endDate ? st.withdrawnAt : e.endDate;

    const started = !e.startDate || e.startDate <= prevLast;
    const openAtEnd = !leftOn || leftOn > prevLast || (leftOn === prevLast && !e.isTransferred);
    if (started && openAtEnd) {
      const t = teacherOn(e.classId, prevLast);
      if (t) students.set(t, (students.get(t) ?? new Set<string>()).add(e.studentId));
    }

    if (!leftOn || leftOn.slice(0, 7) !== input.prevMonth || e.isTransferred) continue;
    // 나간 날의 담임 — 반이동(반 단위)·끝나기 전 날 기준이 아니라 그 날 담임이 그 학생을 잃었다.
    const t = teacherOn(e.classId, leftOn);
    if (!t) continue;
    if (st.withdrawn) add(withdrawn, t, e.studentId, st.name);
    else if (!(cls.subject && liveSubjects.get(e.studentId)?.has(cls.subject))) add(ended, t, e.studentId, st.name);
  }
  // 같은 학생이 한 담임 아래 퇴원·수강 종료 둘에 겹치면(한 반은 수강 종료, 다음 반에서 퇴원) 퇴원만 남긴다.
  for (const [t, m] of withdrawn) for (const id of m.keys()) ended.get(t)?.delete(id);

  const list = (m?: Map<string, string>) =>
    [...(m ?? new Map<string, string>())].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const out = new Map<string, HomeroomPrevFlow>();
  for (const t of new Set([...students.keys(), ...withdrawn.keys(), ...ended.keys()])) {
    out.set(t, { students: students.get(t)?.size ?? 0, withdrawn: list(withdrawn.get(t)), ended: list(ended.get(t)) });
  }
  return out;
}
