import { zoomPlan, type ExploreModel, type ExploreRow, type ExploreSector, type ExploreTarget } from "../../model";
import { netTargetId, type NetHubOpen } from "./types";

/** 네트워크 판 짜기의 규칙 함수([`graph.ts`](./graph.ts) `buildNetGraph`가 쓴다) — 순수 함수. */

/** 조각의 대상(작은 조각 · 대상 · 묶음) — 같은 대상은 한 번, `skip`(다른 조각이 그 대상 자체인 것)은 뺀다. */
export function sectorMembers(s: ExploreSector, skip: ReadonlySet<string>): ExploreTarget[] {
  const all = [...(s.parts ?? []).map((p) => p.target), ...(s.targets ?? []), ...(s.groups ?? []).flatMap((g) => g.targets)];
  const seen = new Set<string>(skip);
  return all.filter((t) => (seen.has(netTargetId(t)) ? false : (seen.add(netTargetId(t)), true)));
}

/** 점으로 세울 줄 — `items`가 있으면 그 내역(빈 배열 = 0건이라 점 없음), 없으면 그 줄 하나. */
export const leafRows = (r: ExploreRow): ExploreRow[] => (r.items ? r.items : [r]);
/** 줄 하나짜리 조각이 곧 그 줄인가(영역 중심 `r:<줄 id>` — 기록 상세가 조각 자체다). */
export const selfRow = (s: ExploreSector): ExploreRow | null => (s.rows?.length === 1 && !s.rows[0].items && s.key === `r:${s.rows[0].id}` ? s.rows[0] : null);

/** 영역 점 더블클릭이 할 일 — 화면의 `zoomPlan`과 같은 판정(흡수 · 그 대상이 중심 · 원본 열기 · 할 일 없음)과 중심이 될 이름. */
export function hubOpen(model: ExploreModel, sel: string): { open?: NetHubOpen; openTo?: string } {
  const plan = zoomPlan(model, sel, [], false);
  if (!plan) return {};
  if ("go" in plan) return plan.to.sector ? { open: "absorb" } : { open: "center", openTo: plan.leaving.label };
  return plan.link ? { open: "link" } : {};
}

/**
 * 영역 중심에서 같은 기록(줄 id)을 맡을 조각 — 그 기록을 담은 조각 중 **기록 수가 가장 적은 것**(같으면 앞 조각).
 * 1단계 중심은 조각마다 원본이 달라(타임라인의 상담 ≠ 상담 조각) 옮기지 않는다. 🔴 대상 조각(`focus` — 반·원생·강사 하나)의 줄은 그 대상의
 * 속성이라 줄 id가 같아도(반마다 `subject`·`schedule` · 사실 칩 `f0`) 다른 기록이다 — 판정에 넣지 않는다(`buildNetGraph`도 옮기지 않는다).
 */
export function claimsOf(model: ExploreModel): Map<string, string> | null {
  if (!model.center.group) return null;
  const pool = model.sectors.filter((s) => !s.focus);
  const size = new Map(pool.map((s) => [s.key, (s.rows ?? []).flatMap(leafRows).length]));
  const owner = new Map<string, string>();
  for (const s of pool)
    for (const it of (s.rows ?? []).flatMap(leafRows)) {
      const cur = owner.get(it.id);
      if (!cur || (size.get(s.key) ?? 0) < (size.get(cur) ?? 0)) owner.set(it.id, s.key);
    }
  return owner;
}
