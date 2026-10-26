/**
 * **교재 배정이 실제에 넣은 것 되돌리기**(옛 월간계획 전체 가져오기 포함) — 순수(Vitest).
 *
 * 원장 2026-10-15: *"월간계획 전체 가져왔을때 실행취소 하는 방법이 필요"*. 가져오기는 빈 칸만 채우는데
 * (`ecs_apply_textbook_lessons`) 무엇을 채웠는지는 돌려주지 않는다 → 가져오기 **앞뒤를 읽어 차이**로 기록한다.
 *
 * 🔴 **고쳐 쓴 칸은 되돌리지 않는다** — 가져온 뒤 사람이 손댄 값을 지우면 그게 진짜 손실이다.
 *    그래서 되돌리기는 "지금 값 = 가져오기가 넣은 값"인 칸만 원래대로 돌리고, 나머지는 세어서 알린다.
 * 🔑 판정은 칸 단위다 — 한 줄에서 진도만 고쳐 썼으면 그 진도는 남기고 가져오기가 채운 다른 칸은 비운다.
 */

export const IMPORT_FIELDS = ["textbook", "page_range", "progress", "homework"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type LineFields = Partial<Record<ImportField, string | null>>;

/** 기록 한 줄 — 새로 만든 줄(`added`)이거나, 있던 줄의 빈 칸을 채운 것. */
export type ImportedRow = {
  id: string;
  added: boolean;
  /** 가져오기가 넣은 값(채운 줄은 바뀐 칸만). */
  after: LineFields;
  /** 채우기 전 값(채운 줄만, 바뀐 칸만). */
  before?: LineFields;
};

/** 비교용 — null·공백만 있는 값은 같은 "빈 칸"이다(RPC가 빈 칸을 `nullif(btrim(..))`로 본다). */
function norm(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * 가져오기 앞뒤 스냅숏 → 기록. `actorId`가 마지막으로 쓴 줄만 담는다 — 그 몇 초 사이 다른 사람이 만든 줄을
 * 가져오기 몫으로 잘못 담으면 되돌리기가 남의 줄을 지운다.
 */
export function diffImport(
  before: ReadonlyMap<string, LineFields>,
  after: readonly (LineFields & { id: string; updated_by: string | null })[],
  actorId: string,
): ImportedRow[] {
  const out: ImportedRow[] = [];
  for (const row of after) {
    if (row.updated_by !== actorId) continue;
    const prev = before.get(row.id);
    const now: LineFields = {};
    for (const f of IMPORT_FIELDS) now[f] = row[f] ?? null;
    if (!prev) {
      out.push({ id: row.id, added: true, after: now });
      continue;
    }
    const was: LineFields = {};
    const put: LineFields = {};
    for (const f of IMPORT_FIELDS) {
      if (norm(prev[f]) !== norm(now[f])) {
        was[f] = prev[f] ?? null;
        put[f] = now[f] ?? null;
      }
    }
    if (Object.keys(put).length > 0) out.push({ id: row.id, added: false, after: put, before: was });
  }
  return out;
}

export type UndoPlan = {
  /** 통째로 지울 줄(가져오기가 만든 줄 + 그대로인 것). */
  deletes: string[];
  /** 칸만 원래대로 돌릴 줄. */
  resets: { id: string; patch: LineFields }[];
  /** 되돌린 줄 수. */
  restored: number;
  /** 고쳐 썼거나(옮겨서) 사라져 남긴 줄 수 — 화면이 "N줄은 남겼습니다"로 밝힌다. */
  kept: number;
};

export function planUndo(rows: readonly ImportedRow[], current: ReadonlyMap<string, LineFields>): UndoPlan {
  const plan: UndoPlan = { deletes: [], resets: [], restored: 0, kept: 0 };
  for (const r of rows) {
    const cur = current.get(r.id);
    if (!cur) {
      // 이미 지워졌거나 미룸·당김으로 옮겨졌다(옮기기는 새 줄을 만든다) — 손댈 게 없다.
      plan.kept += 1;
      continue;
    }
    if (r.added) {
      const untouched = IMPORT_FIELDS.every((f) => norm(cur[f]) === norm(r.after[f]));
      if (untouched) {
        plan.deletes.push(r.id);
        plan.restored += 1;
      } else plan.kept += 1;
      continue;
    }
    const patch: LineFields = {};
    let edited = false;
    for (const f of Object.keys(r.after) as ImportField[]) {
      if (norm(cur[f]) === norm(r.after[f])) patch[f] = r.before?.[f] ?? null;
      else edited = true;
    }
    if (Object.keys(patch).length > 0) {
      plan.resets.push({ id: r.id, patch });
      plan.restored += 1;
    }
    if (edited && Object.keys(patch).length === 0) plan.kept += 1;
  }
  return plan;
}

// ── 기록 한 건에 실리는 **배정 표식** ─────────────────────────────

/**
 * 반영을 만든 **교재 배정**(원장 2026-10-26 *"되돌리기 기능이 동작안한대"*) — 되돌리기가 실제 줄만 비우고
 * 배정을 남겨 두면 빈 칸에 같은 교재가 `계획`으로 다시 그려져 **아무것도 안 바뀐 것처럼** 보인다.
 * 그래서 배정이 만든 반영은 기록에 배정 id를 함께 싣고, 되돌리기가 그 배정까지 지운다.
 *
 * 🔑 새 칼럼 없이 `rows` 배열 안 **표식 원소**로 싣는다(표를 고치면 SQL을 손으로 돌리기 전까지 기록이 끊긴다, [[#95]]).
 *    줄 원소는 `id`·`added`를 갖고 표식은 `kind: "plan"`을 갖는다 — 가르는 곳은 `splitBatchRows` 한 곳.
 */
export type ImportPlanMeta = { kind: "plan"; planId: string; title: string | null };

/**
 * **미룸·당김 / 배정 삭제도 같은 기록에 싣는다**(원장 2026-10-26 *"미룸·당김이랑 배정삭제도 히스토리에 넣어줘"*).
 * 되돌리기 재료는 각 화면의 알림 [되돌리기]가 쓰던 것 그대로(`ShiftUndoToken` / `PlanRestoreRow`) — 실행도 같은
 * 서버 액션(`undoLessonShift` / `undoPlanDelete`)이 한다. 이 기록은 **서버가 쓴 값**이라 클라를 거치지 않는다.
 * 한 기록엔 표식 하나뿐이다(배정 반영 = `plan` + 줄 원소, 미룸·당김 = `shift`, 배정 삭제 = `delete`).
 */
export type ShiftHistoryMeta = { kind: "shift"; shift: "skip" | "advance"; title: string | null; token: unknown };
export type DeleteHistoryMeta = { kind: "delete"; title: string | null; plan: unknown; lines?: unknown };
export type HistoryMeta = ImportPlanMeta | ShiftHistoryMeta | DeleteHistoryMeta;
/** 메뉴에 적는 종류 — 배정(반영) · 미룸 · 당김 · 배정 삭제. */
export type HistoryKind = "fill" | "skip" | "advance" | "delete";

function asTitle(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function readMeta(x: unknown): HistoryMeta | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  if (r.kind === "plan" && typeof r.planId === "string") return { kind: "plan", planId: r.planId, title: asTitle(r.title) };
  if (r.kind === "shift" && (r.shift === "skip" || r.shift === "advance") && r.token && typeof r.token === "object") {
    return { kind: "shift", shift: r.shift, title: asTitle(r.title), token: r.token };
  }
  if (r.kind === "delete" && r.plan && typeof r.plan === "object") {
    return { kind: "delete", title: asTitle(r.title), plan: r.plan, ...(r.lines ? { lines: r.lines } : {}) };
  }
  return null;
}

/**
 * 저장된 `rows` → 줄 기록 + 표식(없으면 null — 옛 기록). `plan`은 배정 반영의 배정 표식만(옛 호출부 호환).
 * 모양이 이상한 원소는 버린다.
 */
export function splitBatchRows(raw: unknown): {
  rows: ImportedRow[];
  plan: ImportPlanMeta | null;
  meta: HistoryMeta | null;
} {
  const list = Array.isArray(raw) ? raw : [];
  let meta: HistoryMeta | null = null;
  const rows: ImportedRow[] = [];
  for (const x of list) {
    const m = readMeta(x);
    if (m) {
      meta ??= m;
      continue;
    }
    if (typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string" && "added" in x) {
      rows.push(x as ImportedRow);
    }
  }
  return { rows, plan: meta?.kind === "plan" ? meta : null, meta };
}

/** 기록 → 메뉴 종류. 표식이 없는 옛 기록은 배정 반영이다. */
export function historyKindOf(meta: HistoryMeta | null): HistoryKind {
  if (meta?.kind === "shift") return meta.shift;
  if (meta?.kind === "delete") return "delete";
  return "fill";
}

/** 미룸·당김 기록의 교재 이름 — 바뀐 줄에서 처음 보이는 교재(없으면 null). */
export function shiftTitleOf(token: {
  removed: readonly { textbook: string | null }[];
  added: readonly { textbook: string | null }[];
  changed: readonly { before: { textbook: string | null }; after: { textbook: string | null } }[];
}): string | null {
  const all = [
    ...token.removed,
    ...token.added,
    ...token.changed.map((c) => c.after),
    ...token.changed.map((c) => c.before),
  ];
  return asTitle(all.find((l) => asTitle(l.textbook))?.textbook ?? null);
}

/** 최근 기록(최신 먼저) 중 `targetId`까지 — 되돌리기는 **그 뒤에 한 반영부터 거꾸로** 전부 되돌린다. 없으면 null. */
export function undoChain<T extends { id: string }>(recentNewestFirst: readonly T[], targetId: string): T[] | null {
  const idx = recentNewestFirst.findIndex((b) => b.id === targetId);
  return idx < 0 ? null : recentNewestFirst.slice(0, idx + 1);
}
