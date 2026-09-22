import { clampRect, initialPlan, smartRect, tilePlan, type Geo, type Rect } from "./geometry";
import { winId, type WinType } from "./rooms";

/** 작업 공간 창 목록 + 배치 판단 — 순수 리듀서(좌표는 캔버스 px). 측정값은 ResizeObserver가 "measure"로 넘긴다. */
export type Win = {
  id: string; type: WinType; arg: string | null;
  x: number; y: number; w: number; h: number;
  min: boolean; max: boolean; prev: Rect | null; z: number;
};
export type WinState = {
  wins: Win[]; focus: string | null; z: number;
  geo: Geo | null; mobile: boolean;
  /** 마지막으로 처음 모습을 짠 캔버스 크기(null = 아직 안 짬). */
  laid: { W: number; H: number; mobile: boolean } | null;
  /** 사람이 창을 건드렸나 — 건드리기 전엔 폭이 바뀔 때마다 처음 모습을 다시 짠다. */
  touched: boolean;
};
export type WinAction =
  | { t: "measure"; geo: Geo; mobile: boolean }
  | { t: "open"; type: WinType; arg: string | null }
  | { t: "focus"; id: string }
  | { t: "min"; id: string; on: boolean }
  | { t: "close"; id: string }
  | { t: "place"; id: string; rect: Rect; max?: boolean; prev?: Rect | null }
  | { t: "max"; id: string }
  | { t: "raiseMany"; ids: string[] }
  | { t: "fold" } | { t: "tile" } | { t: "reset" } | { t: "touch" };

export const EMPTY_WINS: WinState = { wins: [], focus: null, z: 10, geo: null, mobile: false, laid: null, touched: false };

const MOBILE_RECT: Rect = [0, 0, 300, 300];
const at = (r: Rect) => ({ x: r[0], y: r[1], w: r[2], h: r[3] });
const patch = (wins: Win[], id: string, p: Partial<Win>) => wins.map((w) => (w.id === id ? { ...w, ...p } : w));

export function topVisible(wins: Win[]): Win | null {
  let best: Win | null = null;
  for (const w of wins) if (!w.min && (!best || w.z > best.z)) best = w;
  return best;
}
/** 지금 보는 창 = 초점 창(접히지 않았으면), 아니면 맨 위 창. */
export function frontOf(s: WinState): Win | null {
  const f = s.wins.find((w) => w.id === s.focus);
  return f && !f.min ? f : topVisible(s.wins);
}

/** 처음 모습: 시간표·운영실·출석부. 모형 옆에 자리가 없는 창은 접어 둔다(모형을 가리지 않게). */
function initial(s: WinState): WinState {
  const { geo, mobile } = s;
  const plan = !mobile && geo ? initialPlan(geo) : {};
  const wins: Win[] = [];
  let z = 10, focus: string | null = null;
  for (const type of ["tt", "brief", "att"] as const) {
    const arg = type === "att" ? "m2a@1" : null, planned = plan[type], min = !mobile && !planned;
    const r: Rect = mobile || !geo ? MOBILE_RECT : planned ? clampRect(planned, geo.W, geo.H) : smartRect(type, geo, wins);
    wins.push({ id: winId(type, arg), type, arg, ...at(r), min, max: false, prev: null, z: ++z });
    if (!min) focus = winId(type, arg);
  }
  return { ...s, wins, focus, z, touched: false, laid: geo ? { W: geo.W, H: geo.H, mobile } : { W: 0, H: 0, mobile } };
}

const sameGeo = (a: Geo | null, b: Geo) =>
  !!a && a.W === b.W && a.H === b.H && a.model.x === b.model.x && a.model.y === b.model.y && a.model.w === b.model.w && a.model.h === b.model.h;

function measure(s: WinState, geo: Geo, mobile: boolean): WinState {
  // 폰에선 캔버스 높이가 창 높이를 따라가므로(측정 → 배치 → 측정) 값이 같으면 상태를 그대로 둔다.
  if (sameGeo(s.geo, geo) && s.mobile === mobile && s.laid) return s;
  const next = { ...s, geo, mobile };
  const last = s.laid;
  if (!last || last.mobile !== mobile) return initial(next);
  if (mobile) return next;
  const moved = geo.W !== last.W || geo.H !== last.H;
  if ((!s.touched && moved) || Math.abs(geo.W - last.W) > 220) return initial(next);
  if (!moved) return next;
  return { ...next, wins: s.wins.map((w) => ({ ...w, ...at(w.max ? [0, 0, geo.W, geo.H] : clampRect([w.x, w.y, w.w, w.h], geo.W, geo.H)) })) };
}

export function winsReducer(s: WinState, a: WinAction): WinState {
  switch (a.t) {
    case "measure": return measure(s, a.geo, a.mobile);
    case "reset": return initial(s);
    case "touch": return s.touched ? s : { ...s, touched: true };
    case "open": {
      const id = winId(a.type, a.arg), z = s.z + 1;
      if (s.wins.some((w) => w.id === id)) return { ...s, z, touched: true, focus: id, wins: patch(s.wins, id, { min: false, z }) };
      const g = s.geo;
      const r = s.mobile || !g ? MOBILE_RECT : clampRect(smartRect(a.type, g, s.wins), g.W, g.H);
      const win: Win = { id, type: a.type, arg: a.arg, ...at(r), min: false, max: false, prev: null, z };
      return { ...s, z, touched: true, focus: id, wins: [...s.wins, win] };
    }
    case "focus": {
      const z = s.z + 1;
      return { ...s, z, touched: true, focus: a.id, wins: patch(s.wins, a.id, { z, min: false }) };
    }
    case "min": {
      if (!a.on) return winsReducer(s, { t: "focus", id: a.id });
      const wins = patch(s.wins, a.id, { min: true });
      return { ...s, touched: true, wins, focus: s.focus === a.id ? topVisible(wins)?.id ?? null : s.focus };
    }
    case "close": {
      const wins = s.wins.filter((w) => w.id !== a.id);
      return { ...s, touched: true, wins, focus: s.focus === a.id ? topVisible(wins)?.id ?? null : s.focus };
    }
    case "place":
      return { ...s, wins: patch(s.wins, a.id, { ...at(a.rect), ...(a.max !== undefined ? { max: a.max } : {}), ...(a.prev !== undefined ? { prev: a.prev } : {}) }) };
    case "max": {
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || !s.geo || s.mobile) return s;
      if (w.max) return { ...s, wins: patch(s.wins, a.id, { ...at(w.prev ?? [40, 30, 420, 320]), max: false }) };
      return { ...s, wins: patch(s.wins, a.id, { prev: [w.x, w.y, w.w, w.h], max: true, ...at([0, 0, s.geo.W, s.geo.H]) }) };
    }
    case "raiseMany": {
      let z = s.z;
      const order = new Map(a.ids.map((id) => [id, ++z]));
      return { ...s, z, touched: true, focus: a.ids[a.ids.length - 1] ?? s.focus, wins: s.wins.map((w) => (order.has(w.id) ? { ...w, min: false, z: order.get(w.id)! } : w)) };
    }
    case "fold":
      return { ...s, touched: true, focus: null, wins: s.wins.map((w) => ({ ...w, min: true })) };
    case "tile": {
      const g = s.geo;
      if (!g || s.mobile) return s;
      const list = s.wins.filter((w) => !w.min).sort((x, y) => x.z - y.z);
      const rects = new Map(tilePlan(g, list.length).map((r, i) => [list[i].id, clampRect(r, g.W, g.H)]));
      return { ...s, touched: true, wins: s.wins.map((w) => (rects.has(w.id) ? { ...w, ...at(rects.get(w.id)!), max: false } : w)) };
    }
  }
}
