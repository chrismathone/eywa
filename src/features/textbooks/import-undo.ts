/**
 * **월간계획 전체 가져오기 되돌리기** — 순수(Vitest).
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
