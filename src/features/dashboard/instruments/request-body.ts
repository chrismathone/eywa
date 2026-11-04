/**
 * 업무 요청 '내용' — 담당자마다 맡은 학생 · 그 담당자 몫의 신호만 적는다(원장 2026-11-02 *"담임에게 전달할 내용이 너무 두서없이 나열"*).
 * 묶음 · 순서는 근거 학생(`students` — 학생마다 맡은 담당자)과 같다 — 선생님은 제 이름 아래만 읽으면 된다.
 * 다른 담당자 몫은 한 줄('함께 겹친 신호')로만 — 겹친 까닭은 보이되 남의 반 날짜는 섞지 않는다(사람 상세와 같은 원칙).
 * 서식 = 업무 요청 리치 텍스트(`rich-body`). 순수 함수(Vitest).
 */
import type { DraftStudent } from "@/features/work-requests/model";
import { PREFILL_BUDGET, esc, heading, para, strong } from "@/features/work-requests/rich-body";
import { monthDay, num } from "./labels";
import type { StudentSignal, Who } from "./secretary-facts";

export type SignalKind = "absence" | "homework" | "consult";
export const ALL_KINDS: readonly SignalKind[] = ["absence", "homework", "consult"];

const days = (list: readonly string[]) => list.map(monthDay).join(" · ");
const bysOf = (s: StudentSignal, k: SignalKind): readonly Who[] => (k === "absence" ? s.absence?.by : k === "homework" ? s.homework?.by : s.consult?.by) ?? [];
const absentDays = (s: StudentSignal, keep: (b: Who) => boolean) => (s.absence?.by ?? []).filter(keep).reduce((sum, b) => sum + b.dates.length, 0);

/** 담당자 이름(사람 id → 이름) — 신호에 붙은 담임에서. */
export const teacherNames = (signals: readonly StudentSignal[]) =>
  new Map(signals.flatMap((s) => ALL_KINDS.flatMap((k) => bysOf(s, k))).flatMap((w) => (w.id ? [[w.id, w.name] as const] : [])));

/**
 * 학생 s의 신호 k 중 담당자 t 몫 한 줄(t = null이면 담임을 모르는 몫). 없으면 null.
 * `single` = 신호 하나만 다루는 글(제목이 이미 '담임 상담 없음'이라 줄에서 되풀이하지 않는다).
 */
export function partOf(s: StudentSignal, k: SignalKind, t: string | null, single = false): string | null {
  const mine = bysOf(s, k).filter((b) => b.id === t);
  if (!mine.length) return null;
  if (k === "absence") {
    const lines = (s.absence?.by ?? []).filter((b) => b.id === t);
    return `결석 ${num(absentDays(s, (b) => b.id === t))}회 · ${lines.map((b) => `${b.className ?? "반 모름"} ${days(b.dates)}`.trim()).join(" / ")}`;
  }
  if (k === "homework" && s.homework) {
    const h = s.homework;
    const classes = [...new Set(mine.flatMap((b) => (b.className ? [b.className] : [])))];
    return `숙제 60% 미만 ${num(h.low)}/${num(h.parsed)}회${h.zero ? `(0% ${num(h.zero)}회)` : ""}${classes.length ? ` · ${classes.join(" · ")}` : ""}`;
  }
  const last = s.consult?.last ? monthDay(s.consult.last) : null;
  if (single) return last ? `마지막 담임 상담 ${last}` : "담임 상담 기록 없음";
  return `지난달부터 담임 상담 없음 · 마지막 ${last ?? "기록 없음"}`;
}

/** 다른 담당자 몫 — `함께 겹친 신호 — 결석 2회(허은진) · 담임 상담 없음(송지혜)`. 겹친 까닭만 보이게 반 · 날짜는 뺀다. */
export function othersOf(s: StudentSignal, kinds: readonly SignalKind[], t: string | null): string | null {
  const parts = kinds.flatMap((k) => {
    const others = bysOf(s, k).filter((b) => b.id !== t);
    if (!others.length) return [];
    const names = [...new Set(others.map((b) => b.name || "담임 모름"))].join(" · ");
    if (k === "absence") return [`결석 ${num(absentDays(s, (b) => b.id !== t))}회(${names})`];
    return [`${k === "homework" ? "숙제 60% 미만" : "담임 상담 없음"}(${names})`];
  });
  return parts.length ? `함께 겹친 신호 — ${parts.join(" · ")}` : null;
}

/** 학생 한 칸 — 줄이 하나면 한 줄로(`곽경찬 칠성초6 — 결석 2회 · …`), 둘 이상이면 아래 목록으로. */
function itemOf(name: string, s: StudentSignal | undefined, lines: readonly string[]): string {
  const head = `${strong(name)}${s?.schoolGrade ? ` ${esc(s.schoolGrade)}` : ""}`;
  if (!lines.length) return head;
  if (lines.length === 1) return `${head} — ${esc(lines[0]!)}`;
  return `${head}<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

/** 한도 안에서 목록 줄을 잇는다 — 넘치면 거기서 멈춘다(태그 중간을 자르지 않는다). */
function within(used: number, items: readonly string[], budget: number): { html: string; count: number } {
  let html = "";
  let count = 0;
  for (const item of items) {
    const li = `<li>${item}</li>`;
    if (used + html.length + li.length > budget) break;
    html += li;
    count++;
  }
  return { html, count };
}
/** 잘렸을 때 한 줄 — 한 학생이 여러 담당자 아래 있을 수 있어 수는 적지 않는다(근거 학생에는 모두 있다). */
const CUT_NOTE = para(esc("글이 길어 일부 학생은 내용에 적지 못했습니다 — 담당자별 근거 학생에는 모두 있습니다."));

/**
 * 담당자별 묶음 — 묶음은 학생 많은 순 → 이름순, 담당 미정은 맨 뒤. 학생마다 그 담당자 몫의 줄만(`context`면 다른 담당자 몫 한 줄 더).
 * 선생님마다 '○○ 선생님 · N명' 제목 아래만 받는다(`recipient-body`). 한도를 넘으면 거기서 멈추고, 안내 한 줄은 묶음 **앞**에 둔다
 * — 첫 제목 위라 모두가 받는다(맨 끝이면 마지막 선생님 몫이 된다).
 * 🔴 제목 이름은 `nameOf`(요청 창이 넘기는 `recipientNames` — 서버가 몫을 가를 때와 같은 이름)가 먼저다. 신호의 담임 이름은 그것이 없을 때만
 * (신호에 없는 사람 · 이름 없는 직원 · 같은 이름이 둘이면 서버와 달라져 그 선생님 몫이 가지 않는다).
 */
export function assigneeSections(
  students: readonly DraftStudent[], signals: readonly StudentSignal[],
  opts: { kinds: readonly SignalKind[]; context: boolean; budget?: number; nameOf?: (id: string) => string | undefined },
): string {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const names = teacherNames(signals);
  const label = (t: string | null) => (t === null ? "담당 미정" : `${opts.nameOf?.(t) || names.get(t) || "담당자"} 선생님`);
  const groups = new Map<string | null, DraftStudent[]>();
  for (const st of students) groups.set(st.assigneeId, [...(groups.get(st.assigneeId) ?? []), st]);
  const order = [...groups.entries()].sort(([a, x], [b, y]) =>
    (a === null) !== (b === null) ? (a === null ? 1 : -1) : y.length - x.length || label(a).localeCompare(label(b), "ko"));
  const budget = opts.budget ?? PREFILL_BUDGET;
  let html = "";
  let shown = 0;
  for (const [t, list] of order) {
    const items = list.map((st) => {
      const s = byId.get(st.id);
      const lines = s ? opts.kinds.flatMap((k) => { const p = partOf(s, k, t, opts.kinds.length === 1); return p ? [p] : []; }) : [];
      const extra = s && opts.context ? othersOf(s, opts.kinds, t) : null;
      return itemOf(st.name, s, extra ? [...lines, extra] : lines);
    });
    const head = heading(`${label(t)} · ${num(list.length)}명`);
    const part = within(html.length + head.length + 9, items, budget);
    if (part.count) html += `${head}<ul>${part.html}</ul>`;
    shown += part.count;
    if (part.count < items.length) break;
  }
  return shown < students.length ? CUT_NOTE + html : html;
}

/** 한 사람 몫 — 몰린 것마다 제목 · 기준 한 줄 · 학생 목록(그 사람 반 · 그 담임 줄만). 많은 것부터. */
export function personSections(
  personId: string,
  groups: readonly { title: string; note: string; kind: SignalKind; list: readonly StudentSignal[] }[],
  budget = PREFILL_BUDGET,
): string {
  let html = "";
  let full = false;
  for (const g of [...groups].filter((x) => x.list.length).sort((a, b) => b.list.length - a.list.length)) {
    const items = g.list.map((s) => { const p = partOf(s, g.kind, personId, true); return itemOf(s.name, s, p ? [p] : []); });
    const head = `${heading(`${g.title} · ${num(g.list.length)}명`)}${para(esc(g.note))}`;
    const part = within(html.length + head.length + 9, items, budget);
    if (part.count) html += `${head}<ul>${part.html}</ul>`;
    if (part.count < items.length) { full = true; break; }
  }
  return full ? html + CUT_NOTE : html;
}
