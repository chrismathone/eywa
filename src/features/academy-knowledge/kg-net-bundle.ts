import type { NetEdge, NetNode } from "@/features/explore/components/network/types";

/**
 * '묶기'(원장 2026-11-12 *"상단에 '묶기' 토글 옵션을 두고 on/off 가능하게해"*) — 기록 사이 관계선(`focusOnly`)을 **묶음끼리 한 줄**로 모은다.
 * 순수 함수(`"use client"`/`server-only` 금지 — [[#61]]·[[#81]]). 켜고 끄는 값은 계정 귀속(`ui_prefs.knowledgeGraph.bundle` · graph-prefs.ts).
 *  · 잇는 자리 = 그 기록이 든 **분류 묶음 중 가장 아래**(학년 · 과목 — `unit`이 있는 묶음). 날짜 묶음뿐이면 영역 바로 아래 묶음(연도 —
 *    달·일자까지 내리면 선이 다시 수백 개가 된다). 묶음 밖 기록은 그 영역 점.
 *  · 같은 자리끼리(같은 학년 원생 둘)는 잇지 않는다 · 판에 이미 있는 선(뼈대)과 같은 두 점이면 긋지 않는다(같은 열쇠의 선이 둘이 되지 않게 —
 *    같은 영역의 날짜 없는 기록 ↔ 날짜 기록 = 영역 ↔ 연도는 뼈대 선이 이미 잇는다 · 드물다).
 *  · 굵기 = 그 사이 기록 짝 수(`w`) · 기록 사이 선은 그대로 둔다(점을 가리키면 그 점의 선이 나온다).
 *  · 묶음을 접으면 보이는 위 묶음으로 올려 합친다(layout.ts `visibleGraph`) · 요약 판 집계·연결선 수·묶음 안 목록에는 들지 않는다(`bundle`).
 */
export function kgBundleEdges(nodes: readonly NetNode[], edges: readonly NetEdge[]): NetEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchors = new Map<string, string | null>();
  const anchorOf = (id: string): string | null => {
    const got = anchors.get(id);
    if (got !== undefined) return got;
    const n = byId.get(id);
    let top: NetNode | undefined;
    let out: string | null = null;
    for (let p = n?.parent ? byId.get(n.parent) : undefined; p?.kind === "group"; p = p.parent ? byId.get(p.parent) : undefined) {
      if (p.unit) {
        out = p.id;
        break;
      }
      top = p;
    }
    out ??= top?.id ?? n?.hub ?? null;
    anchors.set(id, out);
    return out;
  };
  const drawn = new Set(edges.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
  const pairs = new Map<string, NetEdge>();
  for (const e of edges) {
    if (!e.focusOnly) continue;
    const a = anchorOf(e.from);
    const b = anchorOf(e.to);
    if (!a || !b || a === b || drawn.has(`${a}|${b}`)) continue;
    const [from, to] = a < b ? [a, b] : [b, a];
    const key = `${from}|${to}`;
    const p = pairs.get(key) ?? { from, to, rel: "묶음 사이 관계", w: 0, bundle: true };
    p.w = (p.w ?? 0) + 1;
    pairs.set(key, p);
  }
  return [...pairs.values()];
}
