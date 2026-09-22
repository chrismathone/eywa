import { HOTSPOTS, WIN_META, type RoomId, type WinType } from "./rooms";

/** 캔버스 안 좌표(px). 순수 함수만 — 측정은 desk.tsx가 한다. */
export type Rect = [number, number, number, number];
export type Box = { x: number; y: number; w: number; h: number };
export type Geo = { W: number; H: number; model: Box };
type Placed = { x: number; y: number; w: number; h: number; min: boolean };

const G = 14;

export function clampRect([x, y, w, h]: Rect, W: number, H: number): Rect {
  const ww = Math.max(240, Math.min(w, W));
  const hh = Math.max(170, Math.min(h, H));
  return [Math.min(Math.max(x, -(ww - 90)), W - 90), Math.min(Math.max(y, 0), H - 32), ww, hh];
}

export function dotPos(room: RoomId, m: Box) {
  const [px, py] = HOTSPOTS[room];
  return { x: m.x + (px / 100) * m.w, y: m.y + (py / 100) * m.h };
}

function overlap(a: Rect, b: Rect) {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return x * y;
}

/** 새 창 자리 = 모형 몸통과 다른 창(특히 제목줄)을 가장 덜 가리고, 그 방 점에 가까운 하늘. */
export function smartRect(type: WinType, geo: Geo, others: Placed[]): Rect {
  const { W, H, model: m } = geo;
  const d = WIN_META[type];
  const w = Math.min(d.size[0], W - 2 * G), h = Math.min(d.size[1], H - 2 * G);
  const core: Rect = [m.x + m.w * 0.2, m.y + m.h * 0.02, m.w * 0.72, m.h * 0.96];
  const xs = [G, W - G - w, Math.max(G, m.x + m.w * 0.05 - w), Math.min(W - G - w, m.x + m.w * 0.74), (W - w) / 2, G + 40, W - G - w - 40];
  const ys = [G, G + 44, Math.round((H - h) / 2), H - G - h];
  const dp = d.room ? dotPos(d.room, m) : null;
  if (dp) ys.push(Math.max(G, Math.min(H - G - h, dp.y - h * 0.3)));
  let best: Rect = [G, G, w, h], bs = Infinity;
  for (const x0 of xs) for (const y0 of ys) {
    const x = Math.max(G, Math.min(x0, W - G - w)), y = Math.max(G, Math.min(y0, H - G - h));
    const r: Rect = [x, y, w, h];
    let s = overlap(r, core) * 0.7;
    for (const o of others) if (!o.min) s += overlap(r, [o.x, o.y, o.w, o.h]) + overlap(r, [o.x, o.y, o.w, 34]) * 6;
    if (dp) {
      if (dp.x >= x && dp.x <= x + w && dp.y >= y && dp.y <= y + h) s += w * h * 0.5;
      s += Math.hypot(x + w / 2 - dp.x, y + h / 2 - dp.y) * 2;
    }
    if (s < bs) { bs = s; best = r; }
  }
  return best;
}

/** 처음 모습: 운영실·시간표·출석부를 모형 빈 하늘에. 자리가 없으면 null(=접어 둔다). */
export function initialPlan(geo: Geo): Partial<Record<"brief" | "tt" | "att", Rect>> {
  const { W, H, model: m } = geo;
  const plan: Partial<Record<"brief" | "tt" | "att", Rect>> = {};
  if (W >= 980) {
    let bw = Math.min(430, m.x + m.w * 0.05 - 2 * G);
    if (bw >= 300) plan.brief = [G, G, bw, H - 2 * G];
    else { bw = Math.min(430, m.x + m.w * 0.18 - 2 * G); if (bw >= 290) plan.brief = [G, G, bw, Math.max(300, m.y + m.h * 0.6 - 2 * G)]; }
    const rx = m.x + m.w * 0.74, rw = W - G - rx;
    if (rw >= 380) {
      const tw = Math.min(rw, 540);
      plan.tt = [W - G - tw, G, tw, Math.min(Math.round(H * 0.5), m.y + m.h * 0.64 - 2 * G)];
      const aw = Math.min(rw - 24, 430), ay = Math.round(H * 0.44), ax = Math.max(m.x + m.w * 0.95, W - G - 430), aw2 = W - G - ax;
      plan.att = aw2 >= 390 ? [ax, ay, aw2, H - ay - G] : [W - G - aw, ay, aw, H - ay - G];
    } else if (rw >= 300) plan.att = [rx, G, rw, Math.min(H - 2 * G, Math.max(330, m.y + m.h * 0.66 - 2 * G))];
  } else {
    const x0 = m.x + m.w * 0.74, w0 = W - G - x0, x1 = m.x + m.w + 4, w1 = W - G - x1, half = Math.round((H - 3 * G) / 2);
    if (w0 >= 320) plan.att = [x0, G, w0, half + 40];
    if (w1 >= 300) plan.brief = [x1, half + G + 40, w1, H - half - 2 * G - 40];
  }
  return plan;
}

/** 창 정렬: 모형 좌우 빈 하늘을 기둥으로 쓰고, 기둥마다 위아래로 나눈다. */
export function tilePlan(geo: Geo, count: number): Rect[] {
  const { W, H, model: m } = geo, g = 12;
  const L = Math.max(0, m.x + m.w * 0.05 - g), R = Math.max(0, W - (m.x + m.w * 0.74) - g);
  let cols: { x: number; w: number }[] = [];
  if (L >= 260) cols.push({ x: g, w: L - g });
  if (R >= 260) cols.push({ x: W - R, w: R - g });
  if (!cols.length) cols = [{ x: g, w: (W - 3 * g) / 2 }, { x: (W + g) / 2, w: (W - 3 * g) / 2 }];
  const per = cols.map(() => 0);
  for (let i = 0; i < count; i++) per[i % cols.length]++;
  const seen = cols.map(() => 0);
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const ci = i % cols.length, k = per[ci], hh = (H - g * (k + 1)) / k, c = cols[ci];
    out.push([c.x, g + seen[ci] * (hh + g), c.w, hh]);
    seen[ci]++;
  }
  return out;
}

type Pt = [number, number];
/** 방 점 → 창 연결선: 가로로 나와 창 옆에서 한 번 꺾여 제목줄로(계단식). 점이 창 밑이면 null. */
export function wireRoute(c: { x: number; y: number }, w: Box): Pt[] | null {
  const R = 23, TB = 16;
  if (w.x >= c.x + R + 14) { const ex = w.x, sx = c.x + R, mx = Math.max(sx + 14, ex - 26); return [[sx, c.y], [mx, c.y], [mx, w.y + TB], [ex, w.y + TB]]; }
  if (w.x + w.w <= c.x - R - 14) { const ex = w.x + w.w, sx = c.x - R, mx = Math.min(sx - 14, ex + 26); return [[sx, c.y], [mx, c.y], [mx, w.y + TB], [ex, w.y + TB]]; }
  const ex = Math.max(w.x + 26, Math.min(c.x, w.x + w.w - 26));
  if (w.y + w.h <= c.y - R - 14) { const ey = w.y + w.h, sy = c.y - R, my = Math.min(sy - 14, ey + 26); return [[c.x, sy], [c.x, my], [ex, my], [ex, ey]]; }
  if (w.y >= c.y + R + 14) { const ey = w.y, sy = c.y + R, my = Math.max(sy + 14, ey - 26); return [[c.x, sy], [c.x, my], [ex, my], [ex, ey]]; }
  return null;
}

/** 꺾이는 모서리를 둥글게(반지름 rad) 이은 SVG 경로. */
export function stepPath(pts: Pt[], rad: number): string {
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p1, p2] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const r = Math.min(rad, l1 / 2, l2 / 2);
    if (r < 1) { d += ` L${f(p1[0])} ${f(p1[1])}`; continue; }
    const ax = p1[0] + ((p0[0] - p1[0]) / l1) * r, ay = p1[1] + ((p0[1] - p1[1]) / l1) * r;
    const bx = p1[0] + ((p2[0] - p1[0]) / l2) * r, by = p1[1] + ((p2[1] - p1[1]) / l2) * r;
    d += ` L${f(ax)} ${f(ay)} Q${f(p1[0])} ${f(p1[1])} ${f(bx)} ${f(by)}`;
  }
  const e = pts[pts.length - 1];
  return `${d} L${f(e[0])} ${f(e[1])}`;
}
