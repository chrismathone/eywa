import { DUTY_KIND_KEYS, dutyState, type DutyItemView, type DutyState } from "./kinds";

/**
 * 강사 홈 '오늘 내 업무' 화면 조립(순수) — 학생 카드 묶기 · 정렬 · 반 칩 · 종류별 숫자 · 최근 7일 띠.
 * 상태 순서 = 기한 초과 → 아직 → 완료(해야 할 것이 위로 — 빈 칸이 곧 할 일).
 */
export type DutyCard = {
  key: string; title: string; sub: string; classId: string | null; studentId: string | null;
  items: DutyItemView[]; worst: DutyState;
  /** 최근 7일(오늘 포함) 학생의 의무 완료 비율 — 그날 의무가 없으면 null. */
  week: (number | null)[];
};
export type DutyWeekCell = { day: string; studentKey: string; total: number; done: number };
export type DutyKindCount = { kind: string; total: number; done: number; late: number };

const RANK: Record<DutyState, number> = { late: 0, open: 1, done: 2, void: 3 };
export const studentKeyOf = (it: Pick<DutyItemView, "studentId" | "classId">): string => it.studentId ?? `class:${it.classId}`;

export function worstState(items: readonly DutyItemView[], now: number): DutyState {
  return items.map((i) => dutyState(i.status, i.dueAt, now)).sort((a, b) => RANK[a] - RANK[b])[0] ?? "done";
}

export function buildDutyCards(items: readonly DutyItemView[], week: readonly DutyWeekCell[], days: readonly string[], now: number): DutyCard[] {
  const groups = new Map<string, DutyCard>();
  for (const it of items) {
    const key = studentKeyOf(it);
    const g = groups.get(key) ?? { key, title: it.studentName ?? it.className ?? "반", sub: it.studentId ? it.className ?? "" : "반 알림장",
      classId: it.classId, studentId: it.studentId, items: [], worst: "done", week: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const weekOf = new Map<string, Map<string, DutyWeekCell>>();
  for (const w of week) weekOf.set(w.studentKey, (weekOf.get(w.studentKey) ?? new Map()).set(w.day, w));
  for (const g of groups.values()) {
    g.items.sort((a, b) => DUTY_KIND_KEYS.indexOf(a.kind as never) - DUTY_KIND_KEYS.indexOf(b.kind as never));
    g.worst = worstState(g.items, now);
    g.week = days.map((d) => { const c = weekOf.get(g.key)?.get(d); return c && c.total ? c.done / c.total : null; });
  }
  return [...groups.values()].sort((a, b) => RANK[a.worst] - RANK[b.worst] || a.title.localeCompare(b.title, "ko"));
}

export function countByKind(items: readonly DutyItemView[], now: number): DutyKindCount[] {
  const out = new Map<string, DutyKindCount>();
  for (const it of items) {
    const c = out.get(it.kind) ?? { kind: it.kind, total: 0, done: 0, late: 0 };
    if (it.status !== "void") c.total++;
    const st = dutyState(it.status, it.dueAt, now);
    if (st === "done") c.done++;
    if (st === "late") c.late++;
    out.set(it.kind, c);
  }
  return [...out.values()].sort((a, b) => DUTY_KIND_KEYS.indexOf(a.kind as never) - DUTY_KIND_KEYS.indexOf(b.kind as never));
}

export type DutyClassChip = { classId: string; name: string; total: number; open: number; late: number };
export function classChips(items: readonly DutyItemView[], now: number): DutyClassChip[] {
  const out = new Map<string, DutyClassChip>();
  for (const it of items) {
    if (!it.classId) continue;
    const c = out.get(it.classId) ?? { classId: it.classId, name: it.className ?? "반", total: 0, open: 0, late: 0 };
    const st = dutyState(it.status, it.dueAt, now);
    if (it.status !== "void") c.total++;
    if (st === "open") c.open++;
    if (st === "late") c.late++;
    out.set(it.classId, c);
  }
  return [...out.values()].sort((a, b) => b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, "ko"));
}

/** 칸을 누르면 가는 곳 — 수학 등 보고서 반은 원스크린의 그 학생 줄, 영어 반 알림장은 ECS 홈. */
export function dutyHref(it: Pick<DutyItemView, "studentId" | "classId" | "cycle" | "subject">): string {
  if (!it.studentId) return "/ecs";
  const q = new URLSearchParams({ date: it.cycle });
  if (it.classId) q.set("class", it.classId);
  q.set("student", it.studentId);
  return `/onescreen?${q.toString()}`;
}

/** 오늘 포함 n일의 KST 날짜(YYYY-MM-DD) — UTC로 자르면 하루가 밀리므로 9시간을 더해 자른다. */
export function lastDays(today: string, n: number): string[] {
  const base = Date.parse(`${today}T00:00:00+09:00`) + 9 * 3_600_000;
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** 반별 묶음 — 화면은 **항상 반별로** 가른다(원장 2026-11-09 *"항상 반별로 분리할것"*). 늦은 반 → 아직 있는 반 → 다 한 반 순.
 *  반 알림장(학생 없음) 카드도 그 반 묶음에 든다. 반을 모르는 카드는 '반 없음' 묶음 맨 뒤. */
export type DutyClassGroup = { classId: string | null; name: string; cards: DutyCard[]; total: number; done: number; late: number; open: number };
export function groupCardsByClass(cards: readonly DutyCard[], now: number): DutyClassGroup[] {
  const groups = new Map<string, DutyClassGroup>();
  for (const c of cards) {
    const key = c.classId ?? "";
    const name = c.items.find((i) => i.className)?.className ?? (c.classId ? "반" : "반 없음");
    const g = groups.get(key) ?? { classId: c.classId, name, cards: [], total: 0, done: 0, late: 0, open: 0 };
    g.cards.push(c);
    for (const it of c.items) {
      if (it.status !== "void") g.total++;
      const st = dutyState(it.status, it.dueAt, now);
      if (st === "done") g.done++; else if (st === "late") g.late++; else if (st === "open") g.open++;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.classId === null ? 1 : 0) - (b.classId === null ? 1 : 0) || b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, "ko"));
}
