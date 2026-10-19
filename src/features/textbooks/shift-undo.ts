/**
 * **미룸·당김 되돌리기** — 순수(Vitest). IO는 [`shift-undo-actions.ts`](./server/shift-undo-actions.ts).
 *
 * 원장 2026-10-19: *"미루고, 당길때 얼럿창 띄우고 덮어쓰기(되돌리기)"* → (가) 확인 창에서 [덮어쓰기]를 누르면
 * 실행하고, 실행 뒤 토스트의 [되돌리기]가 **누르기 전 줄을 그대로** 돌려놓는다. 반대 버튼(당김↔미룸)은 줄
 * 내용을 되살리지 못한다 — 미룸이 누른 칸을 지우기 때문이다(2026-10-19 *"미루면 해당영역 날리고"*).
 *
 * 🔑 기록 = 누르기 **앞뒤 차이**만(평시 줄 · 누른 날 이후 + 그 반의 표식). 지워진 줄은 통째로, 새로 생긴 줄은
 *    id와 모습을, 고친 줄은 앞뒤 모습을 담는다. 옮기기는 "새 줄 만들고 옛 줄 지우기"라 지움+생김으로 잡힌다.
 * 🔴 **그 사이 바뀐 게 있으면 통째로 안 한다** — 새로 생긴·고친 줄이 지금도 그 모습인지, 지워진 줄 자리가
 *    아직 비어 있는지, 표식이 그대로인지를 본다. 하나라도 다르면 남의 입력을 덮게 되므로 거절하고 알린다
 *    (일부만 되돌리면 순서가 꼬인 반쪽 상태가 남는다).
 */

/** 기록에 담는 줄 모습 — `class_sheet_plan_lines`의 내용 칸 전부(시각·작성자는 뺀다). */
export type UndoLine = {
  id: string;
  plan_date: string;
  slot_start: string;
  term_mode: string;
  skill_area: string;
  line_no: number;
  textbook: string | null;
  page_range: string | null;
  progress: string | null;
  homework: string | null;
};
export type ShiftKind = "skip" | "advance";

export type ShiftUndoToken = {
  classId: string;
  /** 누른 날 — 이 날 이후만 기록했다. */
  date: string;
  /** 누른 교시(`"HH:MM"`) — 되돌린 뒤 화면이 그 칸(과 그 주)을 다시 그린다. */
  slot: string;
  removed: UndoLine[];
  added: UndoLine[];
  changed: { before: UndoLine; after: UndoLine }[];
  /** 키 `"YYYY-MM-DD|HH:MM"`. */
  markers: { key: string; before: ShiftKind | null; after: ShiftKind | null }[];
};

export const UNDO_FIELDS = [
  "plan_date",
  "slot_start",
  "term_mode",
  "skill_area",
  "line_no",
  "textbook",
  "page_range",
  "progress",
  "homework",
] as const;

/** DB 행 → 기록 줄(날짜·시각 표기를 고정한다 — `time`은 `18:20:00`으로 온다). */
export function toUndoLine(r: Record<string, unknown>): UndoLine {
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    plan_date: String(r.plan_date).slice(0, 10),
    slot_start: String(r.slot_start).slice(0, 5),
    term_mode: String(r.term_mode ?? "regular"),
    skill_area: String(r.skill_area ?? ""),
    line_no: Number(r.line_no ?? 0),
    textbook: text(r.textbook),
    page_range: text(r.page_range),
    progress: text(r.progress),
    homework: text(r.homework),
  };
}

export function sameUndoLine(a: UndoLine, b: UndoLine): boolean {
  return UNDO_FIELDS.every((f) => a[f] === b[f]);
}

export function diffShift(input: {
  classId: string;
  date: string;
  slot: string;
  before: readonly UndoLine[];
  after: readonly UndoLine[];
  markersBefore: Readonly<Record<string, ShiftKind>>;
  markersAfter: Readonly<Record<string, ShiftKind>>;
}): ShiftUndoToken {
  const before = new Map(input.before.map((l) => [l.id, l]));
  const after = new Map(input.after.map((l) => [l.id, l]));
  const token: ShiftUndoToken = { classId: input.classId, date: input.date, slot: input.slot, removed: [], added: [], changed: [], markers: [] };
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) token.removed.push(b);
    else if (!sameUndoLine(a, b)) token.changed.push({ before: b, after: a });
  }
  for (const [id, a] of after) if (!before.has(id)) token.added.push(a);
  for (const key of new Set([...Object.keys(input.markersBefore), ...Object.keys(input.markersAfter)])) {
    const b = input.markersBefore[key] ?? null;
    const a = input.markersAfter[key] ?? null;
    if (b !== a) token.markers.push({ key, before: b, after: a });
  }
  return token;
}

export function isEmptyUndo(t: ShiftUndoToken): boolean {
  return t.removed.length + t.added.length + t.changed.length + t.markers.length === 0;
}

export type ShiftUndoPlan =
  | {
      ok: true;
      /** 서버는 되돌려 고치기 → 지우기 → 되살리기 → 표식 순으로 쓴다(`undoLessonShift`). */
      deletes: string[];
      restores: UndoLine[];
      reinserts: UndoLine[];
      markers: { key: string; kind: ShiftKind | null }[];
    }
  | { ok: false; reason: "changed" };

/**
 * @param current        기록에 나온 id들의 **지금** 줄(그 반 것만 — 남의 반 id는 없는 셈).
 * @param currentMarkers 기록에 나온 표식 칸의 지금 표식.
 * @param occupied       되살릴 줄이 들어갈 칸들에서 **기록 밖의 줄**(이번 되돌리기가 지우거나 고치지 않는 줄)이
 *                       지금 차지한 자리(`slotOf`).
 */
export function planShiftUndo(
  token: ShiftUndoToken,
  current: ReadonlyMap<string, UndoLine>,
  currentMarkers: Readonly<Record<string, ShiftKind>>,
  occupied: ReadonlySet<string>,
): ShiftUndoPlan {
  const changed = { ok: false as const, reason: "changed" as const };
  for (const a of token.added) {
    const now = current.get(a.id);
    if (!now || !sameUndoLine(now, a)) return changed;
  }
  for (const c of token.changed) {
    const now = current.get(c.after.id);
    if (!now || !sameUndoLine(now, c.after)) return changed;
  }
  for (const r of token.removed) if (current.has(r.id)) return changed;
  for (const m of token.markers) if ((currentMarkers[m.key] ?? null) !== m.after) return changed;

  // 되살릴 자리를 지금 **기록 밖의 줄**이 차지했으면 — 그 사이 누가 새로 쓴 것이다.
  for (const r of token.removed) if (occupied.has(slotOf(r))) return changed;
  for (const c of token.changed) {
    if (slotOf(c.before) !== slotOf(c.after) && occupied.has(slotOf(c.before))) return changed;
  }
  return {
    ok: true,
    deletes: token.added.map((a) => a.id),
    restores: token.changed.map((c) => c.before),
    reinserts: token.removed,
    markers: token.markers.map((m) => ({ key: m.key, kind: m.before })),
  };
}

/** 줄 자리 키 — 위치 유니크(`…, plan_date, slot_start, term_mode, line_no`)와 같은 축. */
export function slotOf(l: Pick<UndoLine, "plan_date" | "slot_start" | "term_mode" | "line_no">): string {
  return `${l.plan_date}|${l.slot_start}|${l.term_mode}|${l.line_no}`;
}
