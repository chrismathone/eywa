/**
 * 업무 비서의 재료 — '확인할 일'이 이미 받은 값(같은 원본)을 학생 · 사람 단위로 다시 묶는다. 새로 판정하지 않는다.
 * 🔴 사람은 id로만 묶는다(이름으로 사람을 찾지 않는다 — 동명이인). 신호마다 책임진 담임을 따로 든다
 * (결석 = 결석한 반의 담임 · 숙제 = 숙제가 나온 반의 담임 · 상담 = 그 담임 줄 — `requestPrefill`과 같은 규칙).
 * 사람 상세 · 요청은 그 사람 몫의 신호만 쓴다(원장 2026-11-02 *"뭐가 몰렸는지 도저히 알 수가 없네"* — 다른 반 값이 섞이면 읽을 수 없다). 순수 함수(Vitest).
 */
import { taskKindLabel } from "@/features/staff-tasks/kinds";
import { isLate, isOpen, myTurn, type WorkBoard } from "@/features/work-requests/model";
import { missedTwice } from "./consult";
import type { DetailContext } from "./details-types";
import type { LateTask } from "./extras-types";

/** 그 신호를 책임진 담임과 반(사람 id가 없으면 null — 사람에게 붙지 않는다). */
export type Who = { id: string | null; name: string; classId: string | null; className: string | null };
export type StudentSignal = {
  id: string; name: string; schoolGrade: string | null;
  /** 사전 통보 제외 결석(14일) — `count` = 카드 명단의 값 · `by` = 반마다의 사전 통보 제외 결석일. */
  absence: { count: number; dates: string[]; by: (Who & { dates: string[]; notified: number })[] } | null;
  /** 최근 7일 숙제 60% 미만 기록 수 / 판정한 기록 수. */
  homework: { low: number; parsed: number; zero: number; notSubmitted: number; by: Who[] } | null;
  /** 지난달부터 담임 상담 없음 — `prev` = 지난달 칸(없음 · 다른 사람이 상담) · `last` = 마지막 담임 상담일. */
  consult: { last: string | null; prev: string | null; by: Who[] } | null;
};
export type PersonLoad = {
  id: string; name: string;
  absence: string[]; homework: string[]; consult: string[];
  lateTasks: number; openTasks: number;
  /** 기한 지난 할 일의 종류(라벨 · 많은 순) · 건마다(오래 늦은 순 · 처리 화면 링크). */
  lateKinds: { label: string; late: number }[];
  lateItems: LateTask[];
  /** 이 사람이 맡아 아직 보고하지 않은 업무 요청 · 그중 기한 지남. */
  work: { open: number; late: number };
};

type Ctx = Pick<DetailContext, "snapshot" | "extras">;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

export const signalCount = (s: StudentSignal) => [s.absence, s.homework, s.consult].filter(Boolean).length;
/** 신호 무게 — 결석 3 · 숙제 2 · 상담 1. 겹친 학생 = 결석 · 숙제 중 하나 이상 + 다른 신호 하나 이상. */
export const weightOf = (s: StudentSignal) => (s.absence ? 3 : 0) + (s.homework ? 2 : 0) + (s.consult ? 1 : 0);
export const isOverlap = (s: StudentSignal) => signalCount(s) >= 2 && !!(s.absence || s.homework);
const byWeight = (a: StudentSignal, b: StudentSignal) => weightOf(b) - weightOf(a) || (b.absence?.count ?? 0) - (a.absence?.count ?? 0) || a.name.localeCompare(b.name, "ko");
/** 그 학생에게 붙은 담임(사람 id) — 신호 셋을 합친다. */
export const teacherIdsOf = (s: StudentSignal) => [...new Set([...(s.absence?.by ?? []), ...(s.homework?.by ?? []), ...(s.consult?.by ?? [])].flatMap((w) => (w.id ? [w.id] : [])))];
/** 그 학생의 담임 이름(겹치지 않게). */
export const teacherNamesOf = (s: StudentSignal) => [...new Map([...(s.absence?.by ?? []), ...(s.homework?.by ?? []), ...(s.consult?.by ?? [])].flatMap((w) => (w.id ? [[w.id, w.name] as const] : []))).values()];

export function studentSignals({ snapshot, extras }: Ctx): StudentSignal[] {
  const map = new Map<string, StudentSignal>();
  const get = (id: string, name: string, schoolGrade: string | null) => {
    const found = map.get(id);
    if (found) return found;
    const made: StudentSignal = { id, name, schoolGrade, absence: null, homework: null, consult: null };
    map.set(id, made);
    return made;
  };
  const lines = extras.absenceLines ?? [];
  for (const row of snapshot.sections.absences?.data?.rows ?? []) {
    const mine = lines.filter((l) => l.studentId === row.studentId);
    get(row.studentId, row.studentName, mine[0]?.schoolGrade ?? null).absence = {
      count: row.unexplained, dates: [...new Set(mine.flatMap((l) => l.dates))].sort(),
      by: mine.map((l) => ({ id: l.teacherId, name: l.teacher ?? "", classId: l.classId, className: l.className, dates: l.dates, notified: l.notified })),
    };
  }
  for (const h of extras.report?.students ?? []) {
    const classIds = new Set(h.classes.map((c) => c.classId));
    const by = (extras.roster?.students[h.id] ?? []).filter((e) => classIds.has(e.classId)).map((e) => ({ id: e.teacherId, name: e.teacher ?? "", classId: e.classId, className: e.className }));
    get(h.id, h.name, h.schoolGrade).homework = { low: h.low, parsed: h.parsed, zero: h.zero, notSubmitted: h.notSubmitted, by };
  }
  for (const row of extras.consult?.homeroom?.rows ?? []) {
    for (const p of row.pending.filter(missedTwice)) {
      const s = get(p.id, p.name, p.grade);
      s.consult ??= { last: p.last, prev: p.prev, by: [] };
      if (!s.consult.by.some((w) => w.id === row.id)) s.consult.by.push({ id: row.id, name: row.name, classId: null, className: null });
    }
  }
  return [...map.values()].sort(byWeight);
}

/** 사람마다 몰린 일 — 그 사람이 책임진 신호의 학생 · 기한 지난 할 일 · 맡은 업무 요청. 일이 없는 사람은 빠진다. */
export function peopleLoad(signals: readonly StudentSignal[], extras: Ctx["extras"], work: WorkBoard | null, today: string): PersonLoad[] {
  const map = new Map<string, PersonLoad>();
  const get = (id: string, name: string) => {
    const found = map.get(id);
    if (found) { if (!found.name && name) found.name = name; return found; }
    const made: PersonLoad = { id, name, absence: [], homework: [], consult: [], lateTasks: 0, openTasks: 0, lateKinds: [], lateItems: [], work: { open: 0, late: 0 } };
    map.set(id, made);
    return made;
  };
  const add = (list: readonly Who[] | undefined, key: "absence" | "homework" | "consult", student: string) => {
    for (const w of list ?? []) if (w.id) { const p = get(w.id, w.name); if (!p[key].includes(student)) p[key].push(student); }
  };
  for (const s of signals) { add(s.absence?.by, "absence", s.id); add(s.homework?.by, "homework", s.id); add(s.consult?.by, "consult", s.id); }
  for (const p of extras.taskBoard?.people ?? []) {
    if (!p.open && !p.late) continue;
    const person = get(p.id, p.name);
    person.lateTasks = p.late;
    person.openTasks = p.open;
    person.lateKinds = (p.kinds ?? []).filter((k) => k.late > 0).map((k) => ({ label: taskKindLabel(k.kind), late: k.late })).sort((a, b) => b.late - a.late);
    person.lateItems = p.items ?? [];
  }
  for (const item of work?.items ?? []) {
    if (item.status !== "working") continue;
    for (const step of item.steps) {
      if (step.state === "reported") continue;
      const person = get(step.user.id, step.user.name);
      person.work.open += 1;
      if (isLate(item, today)) person.work.late += 1;
    }
  }
  return [...map.values()].filter((p) => personScore(p) > 0).sort((a, b) => personScore(b) - personScore(a) || a.name.localeCompare(b.name, "ko"));
}

/** 정렬 무게 — 결석 3 · 기한 지난 일 2 · 숙제 2 · 상담 1(화면에 점수는 내지 않는다). */
export const personScore = (p: PersonLoad) => p.absence.length * 3 + p.lateTasks * 2 + p.work.late * 2 + p.homework.length * 2 + p.consult.length + p.work.open;
export const studentsOf = (p: PersonLoad) => [...new Set([...p.absence, ...p.homework, ...p.consult])];

export type Delegated = {
  waiting: number;
  late: { id: string; title: string; dueOn: string; missing: string[] }[];
  review: { id: string; title: string }[];
  report: { id: string; title: string }[];
};
/** 내가 맡긴 일 · 내 차례 — 업무 흐름 구역과 같은 판정(`myTurn` · `isLate`). */
export function delegatedOf(work: WorkBoard | null, today: string): Delegated {
  const items = work?.items ?? [];
  const me = work?.me ?? null;
  const mine = items.filter((i) => isOpen(i) && i.requester?.id === me);
  return {
    waiting: mine.filter((i) => i.status === "working").length,
    late: mine.filter((i) => i.status === "working" && isLate(i, today)).map((i) => ({ id: i.id, title: i.title, dueOn: i.dueOn ?? "", missing: i.steps.filter((s) => s.state !== "reported").map((s) => s.user.name) })),
    review: items.filter((i) => myTurn(i, me) === "review").map((i) => ({ id: i.id, title: i.title })),
    report: items.filter((i) => myTurn(i, me) === "report").map((i) => ({ id: i.id, title: i.title })),
  };
}

/** 기한 지난 할 일 — 종류 · 사람(많은 순). `share` = 가장 많이 가진 사람의 몫. */
export function taskBacklog(extras: Ctx["extras"]) {
  const board = extras.taskBoard;
  if (!board) return null;
  const kinds = board.kinds.filter((k) => k.late > 0).map((k) => ({ label: taskKindLabel(k.kind), late: k.late })).sort((a, b) => b.late - a.late);
  const late = kinds.reduce((n, k) => n + k.late, 0);
  if (!late) return null;
  const people = board.people.filter((p) => p.late > 0).sort((a, b) => b.late - a.late).map((p) => ({ id: p.id, name: p.name, late: p.late }));
  const top = people[0] ?? null;
  return { late, kinds, people, top, share: top ? top.late / late : 0 };
}

export function dayOf(today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  return { day: d.getUTCDate(), weekday: WEEKDAY[d.getUTCDay()]! };
}
