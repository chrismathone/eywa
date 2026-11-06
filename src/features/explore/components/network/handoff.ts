import type { ExploreKind } from "../../model";
import { netFitView, type NetBoard, type NetHead, type NetSize } from "./graph";

/**
 * 네트워크 판 이어달리기 — 중심 전환은 **주소 이동**이라 화면(`ExploreView`)이 새로 마운트된다. 시안처럼 판을 그대로 두고 보간하려면
 * 떠나는 판이 지금 모습(점 자리·보기·전환 프레임 값)을 여기 맡기고, 새로 뜬 판이 그것을 받아 **그 프레임에서** 이어 보간한다.
 * 같은 결의 선례 = [`../transition-handoff.ts`](../transition-handoff.ts)(도넛 접힘 이어달리기).
 *
 *  · `pending` — 지금 막 떠나는 판 하나(새 화면이 마운트되며 받는다 · 10초 지나면 버린다).
 *  · `saved` — 들어갈 때 남기는 '떠난 판 그대로'(중심별) — 되돌아갈 때 역재생의 끝(끌어 둔 자리·배율)이 된다. 시안은 경로 항목에 실었다.
 * 모듈 변수 — 문서를 새로 열면 없다(SSR·첫 로드와 어긋나지 않는다). 클라이언트에서만 부른다.
 */

export type NetLeaveTarget = { kind: ExploreKind; id: string; sector?: string };
export const leaveKey = (n: NetLeaveTarget) => (n.sector ? `${n.kind}:${n.id}:${n.sector}` : `${n.kind}:${n.id}`);

/** 지금 떠 있는 판(하나) — 떠날 때 모습을 꺼내 준다. */
export type LiveNet = {
  centerId: string;
  /** 떠나기 직전 처리 — 진행 중인 움직임·강조·hover를 멈춘다(그 모습이 곧 맡기는 판). */
  freeze: () => void;
  board: () => NetBoard | null;
  size: () => NetSize;
  head: () => NetHead;
  /** 방금 더블클릭한 점(1.5초 안) — 축 후보. */
  lastOpened: () => string | null;
};

export type PendingNet = { to: string; dir: "in" | "out"; at: number; board: NetBoard; pivot: string | null; from: string; size: NetSize; head: NetHead };
export type SavedNet = { board: NetBoard; pivotA: string | null; pivotB: string; size: NetSize };

const STALE_MS = 10_000;
const SAVED_MAX = 16;
let live: LiveNet | null = null;
let pending: PendingNet | null = null;
const saved = new Map<string, SavedNet>();

export function registerLiveNet(l: LiveNet): () => void {
  live = l;
  return () => {
    if (live === l) live = null;
  };
}

/** 판 복사 — 자리(pos)는 끌기로 제자리 수정되니 깊게, 보기도 새 객체로. */
export function copyBoard(b: NetBoard): NetBoard {
  const pos: NetBoard["pos"] = {};
  for (const k in b.pos) pos[k] = { x: b.pos[k].x, y: b.pos[k].y };
  return { ...b, nodes: [...b.nodes], edges: [...b.edges], pos, view: { ...b.view }, hover: null };
}

/**
 * 중심을 떠나기 직전에 부른다 — 지금 판을 맡겨 새 화면이 이어서 보간하게 한다. dir 'in' = 들어감(pivot = 더블클릭한 점 id ·
 * 없으면 방금 더블클릭한 점 → 다음 중심과 같은 id의 점 → 그 영역 점) · 'out' = 되돌아감. 돌려주는 값 = 새 화면이 그리기를 미뤄야 할 ms —
 * **늘 0**: 보간은 새 판이 새 모델로 하므로 붙들면 그만큼 늦게 움직인다(네트워크가 떠 있지 않으면 아무것도 맡기지 않는다).
 */
export function prepareNetworkLeave(next: NetLeaveTarget, opts: { dir: "in" | "out"; pivotId: string | null }): number {
  pending = null;
  const l = live;
  if (!l) return 0;
  const to = leaveKey(next);
  if (to === l.centerId) return 0;
  l.freeze();
  const board = l.board();
  if (!board) return 0;
  const size = l.size();
  let pivot: string | null = null;
  if (opts.dir === "in") {
    const base = `${next.kind}:${next.id}`;
    const own = next.sector && (l.centerId === base || l.centerId.startsWith(`${base}:`)) ? `hub:${next.sector}` : null;
    pivot = [opts.pivotId, l.lastOpened(), to, own].find((id): id is string => !!id && !!board.pos[id]) ?? null;
    saved.delete(l.centerId);
    saved.set(l.centerId, { board: copyBoard(board), pivotA: pivot, pivotB: to, size });
    while (saved.size > SAVED_MAX) saved.delete(saved.keys().next().value as string);
  }
  pending = { to, dir: opts.dir, at: Date.now(), board, pivot, from: l.centerId, size, head: l.head() };
  return 0;
}

/** 새로 뜬 판이 자기 중심으로 향한 이어달리기인지(지우지 않는다 — StrictMode 두 번 마운트에도 같은 값). */
export function peekPendingNet(centerId: string): PendingNet | null {
  if (!pending || pending.to !== centerId || Date.now() - pending.at > STALE_MS) return null;
  return pending;
}

export function consumePendingNet(p: PendingNet): void {
  if (pending === p) pending = null;
}

export function savedNetFor(centerId: string): SavedNet | null {
  return saved.get(centerId) ?? null;
}

/**
 * 되돌아갈 때의 끝 판 — 남겨 둔 판이 같은 보기면 그 자리(끌어 둔 점)·보기(판 크기가 같을 때)를 새로 짠 판에 입히고, 아니면 새 판 전체 맞춤.
 * 축 = 들어올 때 더블클릭했던 점(지금 중심으로 들어왔을 때) → 지금 중심과 같은 id의 점 → 영역 중심이면 그 영역 점.
 */
export function backArrival(g: NetBoard, centerId: string, from: string, size: NetSize): { board: NetBoard; pivotA: string | null } {
  const s = savedNetFor(centerId);
  const same = !!s && s.board.mode === g.mode;
  if (s && same) for (const id in g.pos) if (s.board.pos[id]) g.pos[id] = { ...s.board.pos[id] };
  const view = s && same && s.size.w === size.w && s.size.h === size.h ? { ...s.board.view } : netFitView(g, size);
  const board = { ...g, view };
  const parts = from.split(":");
  const cand = [from, parts.length > 2 ? `hub:${parts.slice(2).join(":")}` : null];
  const pivotA = s && same && s.pivotB === from && s.pivotA && board.pos[s.pivotA] ? s.pivotA : (cand.find((id): id is string => !!id && !!board.pos[id]) ?? null);
  return { board, pivotA };
}
