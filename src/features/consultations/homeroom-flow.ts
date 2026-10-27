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
 * 🔑 퇴원 = 학원을 나감 **또는 그 과목을 그만둠**(학원은 다니는데 그 과목 수강이 오늘 하나도 없음 — 원장 *"수강 종료도 결국 그 과목에선 퇴원"*).
 *    반이동·같은 과목 다른 반으로 옮긴 것은 퇴원이 아니다.
 * 🔑 학생 수·퇴원 모두 그날 **상담 의무**가 있는 담임만(가장 많은 요일을 맡은 담임 — `isDuty`, homeroom-duty.ts) — 화목 반에서
 *    화요일만 듣는 학생은 그 반 담임에겐 부담임 학생이라 세지 않는다(원장 2026-10-27).
 */
import { addDays } from "@/lib/date-kst";
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
  /** 그날 그 담임이 그 반으로 그 학생의 상담 의무를 지는가(없으면 모두 의무). */
  isDuty?: (teacherId: string, studentId: string, classId: string, day: string) => boolean;
};

export function buildPrevMonthFlow(input: FlowInput): Map<string, HomeroomPrevFlow> {
  const prevLast = lastDayOf(input.prevMonth);
  const isDuty = input.isDuty ?? (() => true);
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
  const add = (teacher: string, id: string, name: string) => withdrawn.set(teacher, (withdrawn.get(teacher) ?? new Map<string, string>()).set(id, name));

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
      if (t && isDuty(t, e.studentId, e.classId, prevLast)) students.set(t, (students.get(t) ?? new Set<string>()).add(e.studentId));
    }

    if (!leftOn || leftOn.slice(0, 7) !== input.prevMonth || e.isTransferred) continue;
    // 나간 날의 담임 — 반이동(반 단위)·끝나기 전 날 기준이 아니라 그 날 담임이 그 학생을 잃었다.
    const t = teacherOn(e.classId, leftOn);
    // 의무는 나가기 전날(그 수강이 살아 있던 마지막 날)로 본다 — 나간 날엔 그 수강이 이미 명단에 없다.
    const lastDay = e.startDate && e.startDate > addDays(leftOn, -1) ? e.startDate : addDays(leftOn, -1);
    if (!t || !isDuty(t, e.studentId, e.classId, lastDay)) continue;
    if (st.withdrawn || !(cls.subject && liveSubjects.get(e.studentId)?.has(cls.subject))) add(t, e.studentId, st.name);
  }

  const out = new Map<string, HomeroomPrevFlow>();
  for (const t of new Set([...students.keys(), ...withdrawn.keys()])) {
    const list = [...(withdrawn.get(t) ?? [])].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    out.set(t, { students: students.get(t)?.size ?? 0, withdrawn: list });
  }
  return out;
}
