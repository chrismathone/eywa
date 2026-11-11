import { splitSelKey } from "../../model";
import type { NetEngine } from "./engine";
import { fullGraphOf, netRecordInfo, type NetBoard, type NetNode } from "./graph";
import { isGroupOpen } from "./layout";
import { NET_TOGGLE_MS } from "./morph";
import { netDateText } from "./time-tree";

/** 점 하나에 대한 일(시안 `netSelect` · `netOpen` · hover 카드 글 · 강조할 점) — 손짓([`interact.ts`](./interact.ts))과 화면이 함께 쓴다. */

/** 판에 없는 점이면 보이는 가장 가까운 위 점(접힌 날짜 묶음 → 월·연도 · 요약 판 → 영역). 끝내 없으면 null. */
export function visibleOf(B: Pick<NetBoard, "pos">, all: readonly NetNode[], id: string): string | null {
  let cur: string | undefined = id;
  for (let i = 0; cur && i < 6; i++) {
    if (B.pos[cur]) return cur;
    const n = all.find((x) => x.id === cur);
    cur = n?.parent ?? n?.hub;
  }
  return null;
}

/** 강조할 점 — 마우스 올린 점 → 고른 기록 → 고른 영역. 판에 없는 기록이면 보이는 위 점(묶음·영역) · 떠나는 중이면 없음. */
export function activeOf(E: NetEngine): string | null {
  const B = E.board;
  if (!B || E.frozen()) return null;
  const { record, selected } = E.p;
  const a = B.hover || record || (selected ? `hub:${splitSelKey(selected).sectorKey}` : null);
  return a ? visibleOf(B, fullGraphOf(E.p.input).nodes, a) : null;
}

/** 그리기 재료 — 강조할 점 · 영역에 마우스를 올렸는가(그때는 이웃 기록 이름을 숨긴다). */
export function drawFocus(E: NetEngine): { active: string | null; hubHover: boolean } {
  const B = E.board;
  const active = activeOf(E);
  return { active, hubHover: !!(B?.hover && active === B.hover && B.nodes.some((n) => n.id === active && n.kind === "hub")) };
}

/** 방금(1.5초 안) 더블클릭한 점 — 떠날 때 축 후보. */
export function lastOpened(E: NetEngine): string | null {
  return E.opened && performance.now() - E.opened.at < 1500 ? E.opened.id : null;
}

const line = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(" · ");
const OPEN_TEXT = { absorb: "더블클릭 = 흡수", link: "더블클릭 = 원본 화면 열기" } as const;

/**
 * hover 카드의 둘째 줄(원장 2026-11-06 검수) — 날짜(연도 포함)·내용 먼저, 그다음 이 점에만 있는 연결(분석 근거 · 여러 영역), 끝에 더블클릭이 할 일.
 * '이웃 1개'처럼 늘 같은 숫자는 적지 않는다. 영역은 도넛 조각과 같은 요약 글 + 기록 수(+ 영역 중심에서 기록이 옮겨 선 곳).
 */
export function hoverText(n: NetNode, B: NetBoard): string {
  const adj = B.adjacency.get(n.id)?.size ?? 0;
  if (n.kind === "root") return "지금 중심";
  if (n.kind === "hub" && n.virtual) return `학생 온톨로지 · 사실 ${Math.max(0, adj - 1)}개`;
  if (n.kind === "hub") {
    const st = n.state === "denied" ? "열람 권한 없음" : n.state === "error" ? "불러오지 못함" : null;
    const open = n.open === "center" ? `더블클릭 = ${n.openTo ?? "대상"} 중심으로` : n.open ? OPEN_TEXT[n.open] : null;
    const near = n.count != null ? `이웃 영역·분석 ${Math.max(0, adj - 1)}개` : null; // 요약 판만
    // 조각 자체가 기록 하나(영역 중심의 상담 한 건 등) = 그 기록의 날짜·내용. 그 밖 = 도넛 조각과 같은 요약 + 기록 · 항목 · 연결 수(기록·요약 판 같은 글).
    if (n.self) return line([netDateText(n.date), n.detail, near, st, open]);
    const to = n.movedTo ?? [];
    const moved = to.length ? `기록 ${n.moved ?? 0}건은 ${to.slice(0, 3).join("·")}${to.length > 3 ? ` 외 ${to.length - 3}곳` : ""}에` : null;
    return line([n.summary, !!n.tally && `기록 ${n.tally}개`, !!n.items && `항목 ${n.items}개`, !!n.members && `연결 ${n.members}개`, moved, near, st, open]);
  }
  if (n.kind === "group") {
    const hub = B.nodes.find((x) => x.id === n.hub);
    const open = B.nodes.some((x) => x.parent === n.id);
    return line([`${hub?.title ?? "기록"} ${n.tally ?? 0}건`, `더블클릭 = ${open ? "접기" : "펼치기"}`]);
  }
  // 대상이 있는 사실(형제 원생) = 그 원생이 중심(화면이 연다) · 다른 사실은 자세히(오른쪽 패널).
  if (n.kind === "fact") return `온톨로지 사실 · ${n.detail ?? ""} · 더블클릭 = ${n.target ? "그 원생이 중심" : "자세히"}`;
  if (n.kind === "analysis") return n.detail ?? "";
  const evidence = B.edges.filter((e) => e.rel === "근거" && (e.from === n.id || e.to === n.id)).length;
  const hubs = n.kind === "target" ? B.edges.filter((e) => e.to === n.id && e.from.startsWith("hub:")).length : 0;
  // 기록에 `open = "center"`(지식그래프 — 어느 기록이든 그 기록이 중심)면 대상처럼 '이것이 중심'.
  return line([netDateText(n.date), n.detail, evidence > 0 && `분석 근거 ${evidence}건`, hubs > 1 && `영역 ${hubs}곳에 연결`, `더블클릭 = ${n.kind === "target" || n.open === "center" ? "이것이 중심" : "자세히"}`]);
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

/** 날짜 묶음 펼치기·접기 — 기록 판에서만 · 중심 전환 중엔 받지 않는다. 펼친 상태는 판(중심) 하나 동안만(`E.toggled`). */
export function toggleGroup(E: NetEngine, id: string): void {
  if (!E.board || E.view !== "records" || E.busyCenter() || E.frozen()) return;
  if (!E.toggled.delete(id)) E.toggled.add(id);
  E.hoverId = ""; // hover 카드의 '펼치기/접기'가 옛 글로 남지 않게 — 다음 움직임에 새로 쓴다
  E.dom.card.hidden = true;
  const g = E.board.nodes.find((n) => n.id === id);
  E.relayout(g?.parent ?? g?.hub ?? id, NET_TOGGLE_MS, { around: id, focus: id }); // 축 = 그 묶음의 위 점(제자리에 남는다)
}

/**
 * 고른 기록이 접힌 묶음 안에 있으면(기록 패널의 목록에서 골랐을 때) 그 위 묶음을 펼쳐 판에 세운다 — 펼쳤으면 true.
 * 기록 판에서만 · 중심 전환 중엔 하지 않는다(그때는 보이는 위 점을 강조한다 — `activeOf`).
 */
export function revealRecord(E: NetEngine, id: string): boolean {
  const B = E.board;
  if (!B || B.pos[id] || E.view !== "records" || E.busyCenter() || E.frozen()) return false;
  const all = fullGraphOf(E.p.input).nodes;
  const find = (x: string | undefined) => (x ? all.find((n) => n.id === x) : undefined);
  const closed: NetNode[] = [];
  for (let p = find(find(id)?.parent); p; p = find(p.parent)) if (p.kind === "group" && !isGroupOpen(p, E.toggled)) closed.push(p);
  if (closed.length === 0) return false;
  for (const g of closed) if (!E.toggled.delete(g.id)) E.toggled.add(g.id);
  const top = closed[closed.length - 1]; // 가장 위의 접힌 묶음 — 그 위 점 아래를 다시 짠다
  E.relayout(top.parent ?? top.hub ?? id, NET_TOGGLE_MS, { around: top.id, focus: id });
  return true;
}

/** 두 번 클릭 = 그 점이 중심으로(영역 = 흡수 · 가운데 = 상세 · 대상 = 그 대상 · 날짜 묶음 = 펼치기·접기 · 기록·분석·사실 = 자세히) — 시안 `netOpen`. */
export function openNode(E: NetEngine, n: NetNode): void {
  const B = E.board;
  if (!B || E.busy()) return;
  E.lastOpen = performance.now();
  if (n.kind === "group") return toggleGroup(E, n.id);
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
