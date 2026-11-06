import { splitSelKey } from "../../model";
import type { NetEngine } from "./engine";
import { fullGraphOf, netRecordInfo, type NetBoard, type NetNode } from "./graph";

/** 점 하나에 대한 일(시안 `netSelect` · `netOpen` · hover 카드 글 · 강조할 점) — 손짓([`interact.ts`](./interact.ts))과 화면이 함께 쓴다. */

/** 강조할 점 — 마우스 올린 점 → 고른 기록 → 고른 영역. 요약 판에 없는 기록이면 그 영역 · 판에 없으면 없음 · 떠나는 중이면 없음. */
export function activeOf(E: NetEngine): string | null {
  const B = E.board;
  if (!B || E.frozen()) return null;
  const { record, selected } = E.p;
  let a = B.hover || record || (selected ? `hub:${splitSelKey(selected).sectorKey}` : null);
  if (B.mode === "summary" && a && !B.pos[a]) a = (record && fullGraphOf(E.p.input).nodes.find((n) => n.id === record)?.hub) || null;
  return a && B.pos[a] ? a : null;
}

/** 방금(1.5초 안) 더블클릭한 점 — 떠날 때 축 후보. */
export function lastOpened(E: NetEngine): string | null {
  return E.opened && performance.now() - E.opened.at < 1500 ? E.opened.id : null;
}

/** hover 카드의 둘째 줄 — 무엇인지 · 이웃 수 · 더블클릭하면 무엇이 되는지. */
export function hoverText(n: NetNode, B: NetBoard): string {
  const adj = B.adjacency.get(n.id)?.size ?? 0;
  if (n.kind === "root") return "지금 중심";
  if (n.kind === "hub" && n.virtual) return `학생 온톨로지 · 사실 ${Math.max(0, adj - 1)}개`;
  if (n.kind === "hub") {
    const st = n.state === "denied" ? " · 열람 권한 없음" : n.state === "error" ? " · 불러오지 못함" : "";
    return n.count != null
      ? `영역 · 기록 ${n.count}개 · 이웃 영역·분석 ${Math.max(0, adj - 1)}개${st} · 더블클릭 = 흡수`
      : `영역 · 기록 ${Math.max(0, adj - 1)}개${st} · 더블클릭 = 흡수`;
  }
  // 대상이 있는 사실(형제 원생) = 그 원생이 중심(화면이 연다) · 다른 사실은 자세히(오른쪽 패널).
  if (n.kind === "fact") return `온톨로지 사실 · ${n.detail ?? ""} · 더블클릭 = ${n.target ? "그 원생이 중심" : "자세히"}`;
  if (n.kind === "analysis") return n.detail ?? "";
  return `${n.detail ? `${n.detail} · ` : ""}이웃 ${adj}개 · 더블클릭 = ${n.kind === "target" ? "이것이 중심" : "자세히"}`;
}

/** 한 번 클릭 = 고르기(시안 `netSelect`). */
export function selectNode(E: NetEngine, id: string): void {
  const B = E.board;
  const n = B?.nodes.find((x) => x.id === id);
  if (!B || !n) return;
  if (n.kind === "fact" || (n.kind === "hub" && n.virtual)) return E.cb.onSelectRecord(netRecordInfo(n, B));
  if (n.kind === "hub") {
    E.cb.onSelectRecord(null);
    return E.cb.onSelectSector(n.sectorKey ?? null);
  }
  if (n.kind === "root") {
    E.cb.onSelectRecord(null);
    return E.cb.onSelectSector(null);
  }
  E.cb.onSelectRecord(netRecordInfo(n, B));
}

/** 두 번 클릭 = 그 점이 중심으로(영역 = 흡수 · 가운데 = 상세 · 대상 = 그 대상 · 기록·분석·사실 = 자세히) — 시안 `netOpen`. */
export function openNode(E: NetEngine, n: NetNode): void {
  const B = E.board;
  if (!B || E.busy()) return;
  E.lastOpen = performance.now();
  if (n.kind === "fact" || (n.kind === "hub" && n.virtual)) return E.cb.onOpenRecord(netRecordInfo(n, B));
  if (n.kind === "hub") {
    E.opened = { id: n.id, at: performance.now() };
    return E.cb.onZoomSector(n.zoomKey ?? n.sectorKey ?? "");
  }
  if (n.kind === "root") return E.cb.onCenterZoom();
  if (n.kind === "target" && n.target) {
    E.opened = { id: n.id, at: performance.now() };
    return E.cb.onOpenTarget(n.target, n.id);
  }
  E.cb.onOpenRecord(netRecordInfo(n, B));
}

/** 고른 기록의 영역 key — 요약으로 바꿀 때 고른 기록을 그 영역으로 잇는다(분석·사실은 제외). */
export function sectorOfSelection(B: NetBoard | null, recordId: string | null, all: NetNode[]): string | null {
  if (!recordId) return null;
  const n = all.find((x) => x.id === recordId) ?? B?.nodes.find((x) => x.id === recordId);
  return n && n.kind !== "analysis" && n.kind !== "fact" && n.sectorKey ? splitSelKey(n.sectorKey).sectorKey : null;
}
