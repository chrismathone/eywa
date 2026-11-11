import { fullGraphOf, summaryGraph } from "./graph";
import { netCenterOf, type NetBoard, type NetCam, type NetGraph, type NetGroupLevel, type NetInput, type NetNode, type NetPoint, type NetSize, type NetViewMode } from "./types";

/**
 * 네트워크 판 배치(시안 `netLayout` · `netRadius` · `netFitView`) — 순수 함수. 영역은 맨 위부터 고르게(반지름 250 + 기록 수), 영역에 바로 붙은
 * 기록·대상은 제 영역 둘레 황금각 나선(시안 숫자 그대로 — 바꾸면 원장이 다듬은 판 모양이 달라진다), 분석은 가운데 둘레 110.
 * 날짜 묶음(연도 → 월 → 일자)은 영역 바깥쪽 부채꼴로 펼치고(아래 단계가 차지할 둘레만큼 거리를 늘린다), 묶음 아래 기록은 그 묶음 둘레 작은 나선.
 *
 * 묶음은 **처음에 연도만 펼쳐 둔다**(월이 보이고, 월 아래 기록은 접혀 있다 — 원장 2026-11-06 *"이럴 필요가 없어보임"* · 현황 먼저).
 * 더블클릭으로 펼치고 접는다 — 사람이 바꾼 묶음은 `toggled`(기본에서 뒤집은 것)로 받는다. 접힌 묶음 아래는 판에 없다(자리도 차지하지 않는다).
 */

/** 처음 펼쳐 둘 묶음 단계 — 연도는 펼침(월이 보인다) · 월·일자는 접힘. */
export const GROUP_OPEN_DEFAULT: Record<NetGroupLevel, boolean> = { year: true, month: false, day: false };
export const isGroupOpen = (n: NetNode, toggled?: ReadonlySet<string>): boolean => (n.expanded ?? GROUP_OPEN_DEFAULT[n.level ?? "month"]) !== !!toggled?.has(n.id);

/** 보이는 점·선만 — 위 묶음 중 하나라도 접혀 있으면 그 아래는 뺀다. */
export function visibleGraph(g: NetGraph, toggled?: ReadonlySet<string>): NetGraph {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const hidden = (n: NetNode) => {
    for (let p = n.parent ? byId.get(n.parent) : undefined; p; p = p.parent ? byId.get(p.parent) : undefined) if (p.kind === "group" && !isGroupOpen(p, toggled)) return true;
    return false;
  };
  const nodes = g.nodes.filter((n) => !hidden(n));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

const GOLD = Math.PI * (3 - Math.sqrt(5));
/** 영역(시안 숫자) · 묶음 둘레 나선의 j번째 거리. */
const hubSpiral = (j: number) => 22 + 7.5 * Math.sqrt(j + 1);
const groupSpiral = (j: number) => 9 + 5.5 * Math.sqrt(j + 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** 묶음까지의 최소 거리 — 영역 → 연도 · 연도 → 월 → 일자(이름 '2026년 · 27건'이 위 점 이름과 겹치지 않을 만큼). */
const HUB_GAP = 56;
const GROUP_GAP = 36;

/**
 * 판 배치 — 보기는 원점(맞춤은 `netFitView`). `toggled` = 기본에서 펼침·접힘을 뒤집은 묶음 id. `keep`(묶음 펼치기·접기) = 지금 판의 자리와
 * 펼치거나 접은 묶음 — 그 묶음의 위 점 아래(형제 묶음 전체)만 새 배치를 위 점이 있던 자리로 옮겨 쓰고(형제가 벌어져 자리를 낸다), 나머지는 그 자리
 * (끌어 둔 자리 포함) 그대로 — 판 전체가 다시 짜이지 않게.
 */
export function netLayout(input: NetInput, view: NetViewMode, toggled?: ReadonlySet<string>, keep?: { from: Record<string, NetPoint>; around: string } | null): NetBoard {
  const full = fullGraphOf(input);
  const { nodes, edges } = view === "summary" ? summaryGraph(full) : visibleGraph(full, toggled);
  const centerId = netCenterOf(input).id;
  const pos: Record<string, NetPoint> = { [centerId]: { x: 0, y: 0 } };
  const kids = new Map<string, NetNode[]>();
  for (const n of nodes) {
    const p = n.parent ?? n.hub;
    if (p) kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  /** 묶음이 차지하는 둘레 반지름(아래 단계 포함) — 바깥에서 안으로 한 번씩. */
  const ballCache = new Map<string, number>();
  const ball = (id: string): number => {
    const got = ballCache.get(id);
    if (got != null) return got;
    const ch = kids.get(id) ?? [];
    const leaves = ch.filter((n) => n.kind !== "group").length;
    const groups = ch.filter((n) => n.kind === "group").map((g) => ball(g.id));
    const s = leaves > 0 ? groupSpiral(leaves - 1) : 0;
    const r = groups.length === 0 ? Math.max(6, s + 4) : ring(groups, s, GROUP_GAP, Math.PI * 1.2).d + Math.max(...groups) + 2;
    ballCache.set(id, r);
    return r;
  };
  /** 아래 묶음들을 놓을 거리와 몫(각) — 부채꼴 `fan` 안에 다 들어갈 때까지 거리를 늘린다. */
  const ring = (rho: number[], inner: number, min: number, fan: number) => {
    let d = Math.max(inner + 8 + Math.max(...rho), min);
    const widths = () => rho.map((r) => 2 * Math.asin(Math.min(1, (r + 4) / d)));
    for (let i = 0; i < 40 && sum(widths()) > fan; i++) d *= 1.1;
    return { d, w: widths() };
  };
  const place = (id: string, at: NetPoint, out: number, isHub: boolean) => {
    const ch = kids.get(id) ?? [];
    const leaves = ch.filter((n) => n.kind !== "group");
    const groups = ch.filter((n) => n.kind === "group");
    leaves.forEach((n, j) => {
      const rr = isHub ? hubSpiral(j) : groupSpiral(j);
      const ang = out + j * GOLD;
      pos[n.id] = { x: at.x + Math.cos(ang) * rr, y: at.y + Math.sin(ang) * rr };
    });
    if (groups.length === 0) return;
    const inner = leaves.length > 0 ? (isHub ? hubSpiral : groupSpiral)(leaves.length - 1) : isHub ? 12 : 0;
    const { d, w } = ring(groups.map((g) => ball(g.id)), inner, isHub ? HUB_GAP : GROUP_GAP, isHub ? Math.PI : Math.PI * 1.2);
    let cur = out - sum(w) / 2;
    groups.forEach((g, i) => {
      const ang = cur + w[i] / 2;
      cur += w[i];
      pos[g.id] = { x: at.x + Math.cos(ang) * d, y: at.y + Math.sin(ang) * d };
      place(g.id, pos[g.id], ang, false);
    });
  };
  const hubs = nodes.filter((n) => n.kind === "hub");
  const R = 250;
  hubs.forEach((h, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / hubs.length;
    // 영역 거리 = 기록 수(접힌 묶음 안 기록까지 — 펼치고 접어도 영역이 움직이지 않게).
    const size = h.count ?? full.nodes.filter((n) => n.hub === h.id && n.kind !== "group").length;
    const r = R + Math.min(60, size * 1.2);
    pos[h.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    place(h.id, pos[h.id], a, true);
  });
  nodes.filter((n) => n.kind === "analysis").forEach((n, i) => {
    const a = -Math.PI / 2 + Math.PI / 4 + (i * Math.PI) / 2;
    pos[n.id] = { x: Math.cos(a) * 110, y: Math.sin(a) * 110 };
  });
  for (const n of nodes) pos[n.id] ??= { x: 0, y: 0 };
  if (keep) keepPlaces(nodes, pos, keep.from, keep.around);
  const adjacency = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of edges) {
    adjacency.get(e.from)?.add(e.to);
    adjacency.get(e.to)?.add(e.from);
  }
  return { centerId, mode: view, nodes, edges, pos, adjacency, view: { x: 0, y: 0, k: 1 }, hover: null };
}

function keepPlaces(nodes: NetNode[], pos: Record<string, NetPoint>, old: Record<string, NetPoint>, around: string): void {
  const fresh = { ...pos };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const upId = (n: NetNode | undefined) => n?.parent ?? n?.hub;
  const anchor = upId(byId.get(around));
  const under = (n: NetNode) => {
    for (let p = upId(n); p; p = upId(byId.get(p))) if (p === anchor) return true;
    return false;
  };
  const shift = anchor && old[anchor] && fresh[anchor] ? { x: old[anchor].x - fresh[anchor].x, y: old[anchor].y - fresh[anchor].y } : { x: 0, y: 0 };
  for (const n of nodes) {
    if (anchor && under(n)) pos[n.id] = { x: fresh[n.id].x + shift.x, y: fresh[n.id].y + shift.y };
    else if (old[n.id]) pos[n.id] = { ...old[n.id] };
  }
}

const GROUP_R: Record<NetGroupLevel, number> = { year: 6.5, month: 5.2, day: 4.4 };
/** 점 반지름(판 좌표) — 가운데 26 · 영역(요약 = 기록 수 · 기록 = 이웃 수) · 분석 7 · 날짜 묶음 6.5/5.2/4.4 · 기록 3.2. */
export function netRadius(n: NetNode, g: Pick<NetBoard, "adjacency">): number {
  if (n.kind === "root") return 26;
  if (n.kind === "hub") return n.count != null ? 12 + Math.min(26, Math.log2(n.count + 1) * 4.2) : 11 + Math.min(10, Math.log2((g.adjacency.get(n.id)?.size || 1) + 1) * 1.6);
  if (n.kind === "group") return GROUP_R[n.level ?? "month"];
  return n.kind === "analysis" ? 7 : 3.2;
}

/** 전체 맞춤 보기 — 좌우 60 · 위아래 45 여백, 배율 0.05~2.4. */
export function netFitView(g: Pick<NetBoard, "pos">, size: NetSize): NetCam {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of Object.values(g.pos)) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const k = Math.max(0.05, Math.min(2.4, (size.w - 120) / Math.max(100, maxX - minX), (size.h - 90) / Math.max(100, maxY - minY)));
  return { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k };
}
