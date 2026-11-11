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
  /** 같은 7일의 완료/전체 건수 — 주간 표가 쓴다. */
  weekCounts: ({ done: number; total: number } | null)[];
};
/** 장부가 쌓이기 시작한 날(s2_0043 운영 적용) — 그 전 날짜 칸은 "기록 전"이지 "0%"가 아니다. */
export const DUTY_LEDGER_START = "2026-11-09";
/** 학생 × 날 한 칸 — 전체/완료 + 종류별 상태(막대그래프용). */
/** 한 날의 종류 하나 — 'absent' = 결석이라 그날 보고서 업무가 없다(완료 · 전체 수에 들지 않는다 — 칸에 '결석'이라고만 적는다). */
export type DutyWeekKind = { kind: string; state: "done" | "late" | "open" | "absent" };
export type DutyWeekCell = { day: string; studentKey: string; total: number; done: number; kinds?: DutyWeekKind[];
  /** 주간 표의 줄을 세우는 재료 — 학생·반 이름(주간 표는 그 주에 의무가 있던 학생 전원을 줄로 세운다 · 원장 2026-11-10). */
  studentName?: string | null; classId?: string | null; className?: string | null };
/** 주간 칸의 재료 한 줄(장부 행) — `weekCells`가 읽어 온 그대로. */
export type DutyWeekRow = { cycle: string; status: string; voidReason: string | null; studentId: string | null; classId: string | null; kind: string; dueAt: string; studentName: string | null; className: string | null };
/**
 * 장부 행 → 학생 × 반 × 날 칸. 칸 = 전체/완료 수 + 종류별 상태.
 *   · void는 빼되 미처리 확정(`expired`)은 미처리로 센다.
 *   · 🔴 결석으로 빠진 보고서 업무(void · `absent`)는 **수에 넣지 않고 '결석' 조각으로만** 싣는다 — 출결만 있고 보고서가 없는 날이 결석 때문인지 겉으로 보이게
 *     (원장 2026-11-11 *"출결만 하고 (결석한 학생) 보고서를 미발송해도 통과하는 학생이 있는데, 결석해서 미발송했는지 겉으로 판단이 어려움"*).
 */
export function foldWeekRows(rows: readonly DutyWeekRow[], now: number): DutyWeekCell[] {
  const out = new Map<string, DutyWeekCell>();
  for (const r of rows) {
    const absent = r.status === "void" && r.voidReason === "absent";
    if (r.status === "void" && r.voidReason !== "expired" && !absent) continue;
    const studentKey = r.studentId ?? `class:${r.classId}`;
    // 칸 = 학생 × 반 × 날(같은 학생이 두 반을 들으면 반마다 줄).
    const key = `${studentKey}|${r.classId ?? ""}|${r.cycle}`;
    const c = out.get(key) ?? { day: r.cycle, studentKey, total: 0, done: 0, kinds: [], studentName: r.studentName, classId: r.classId, className: r.className };
    if (absent) c.kinds!.push({ kind: r.kind, state: "absent" });
    else {
      c.total++;
      if (r.status === "done") c.done++;
      c.kinds!.push({ kind: r.kind, state: r.status === "done" ? "done" : Date.parse(r.dueAt) < now ? "late" : "open" });
    }
    out.set(key, c);
  }
  return [...out.values()];
}
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
      classId: it.classId, studentId: it.studentId, items: [], worst: "done", week: [], weekCounts: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  // 학생 기준(반이 여럿이면 합산) — 카드의 주간 띠.
  const weekOf = new Map<string, Map<string, DutyWeekCell>>();
  for (const w of week) {
    const per = weekOf.get(w.studentKey) ?? new Map<string, DutyWeekCell>();
    const cur = per.get(w.day);
    per.set(w.day, cur ? { ...cur, total: cur.total + w.total, done: cur.done + w.done } : { day: w.day, studentKey: w.studentKey, total: w.total, done: w.done });
    weekOf.set(w.studentKey, per);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => DUTY_KIND_KEYS.indexOf(a.kind as never) - DUTY_KIND_KEYS.indexOf(b.kind as never));
    g.worst = worstState(g.items, now);
    g.week = days.map((d) => { const c = weekOf.get(g.key)?.get(d); return c && c.total ? c.done / c.total : null; });
    g.weekCounts = days.map((d) => { const c = weekOf.get(g.key)?.get(d); return c && c.total ? { done: c.done, total: c.total } : null; });
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

/** 그 날짜가 든 주 — **항상 월요일 시작**, 월~일 7일(원장 2026-11-10 *"항상 월요일 시작으로 · 월화수목금 + 필요시 토일"*). */
export function weekDaysOf(date: string): string[] {
  const t = Date.parse(`${date}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = 일
  const monday = t - ((dow + 6) % 7) * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86_400_000).toISOString().slice(0, 10));
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

/** 주간 표 — 그 주에 의무가 있던 **학생 × 반 전원**을 반별로 세운다(오늘 줄만이 아니라). 반 순서 = 늦음 많은 반 → 미완료 많은 반 → 이름. */
export type WeekRow = { key: string; title: string; cells: Map<string, DutyWeekCell>; late: number; open: number };
export type WeekGroup = { classId: string | null; name: string; rows: WeekRow[]; late: number; open: number; total: number; done: number };
export function buildWeekTable(week: readonly DutyWeekCell[]): WeekGroup[] {
  const groups = new Map<string, WeekGroup>();
  for (const w of week) {
    const gk = w.classId ?? "";
    const g = groups.get(gk) ?? { classId: w.classId ?? null, name: w.className ?? (w.classId ? "반" : "반 없음"), rows: [], late: 0, open: 0, total: 0, done: 0 };
    let row = g.rows.find((r) => r.key === w.studentKey);
    if (!row) { row = { key: w.studentKey, title: w.studentName ?? w.className ?? "반", cells: new Map(), late: 0, open: 0 }; g.rows.push(row); }
    row.cells.set(w.day, w);
    for (const k of w.kinds ?? []) { if (k.state === "late") { row.late++; g.late++; } else if (k.state === "open") { row.open++; g.open++; } }
    g.total += w.total; g.done += w.done;
    groups.set(gk, g);
  }
  for (const g of groups.values()) g.rows.sort((a, b) => b.late - a.late || b.open - a.open || a.title.localeCompare(b.title, "ko"));
  return [...groups.values()].sort((a, b) => (a.classId === null ? 1 : 0) - (b.classId === null ? 1 : 0) || b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, "ko"));
}
