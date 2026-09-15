import { manualBySlug } from "./manuals";

/** 화면 상자(뷰포트 좌표, px). */
export type Box = { x: number; y: number; w: number; h: number };
export type Viewport = { w: number; h: number };
export type OverlayAnchor = {
  key: string;
  n: number;
  label: string;
  body: string;
  box: Box;
};
export type PlacedCallout = {
  key: string;
  n: number;
  label: string;
  body: string;
  pill: { x: number; y: number };
  balloon: Box;
};

export const PILL_SIZE = 22;
export const BALLOON_W = 220;
const GAP = 8;
const PAD = 8;
/** 이 높이보다 위에 있으면 툴바 — 말풍선을 가로로 펼친다. */
const TOP_BAND = 72;
const MAX_BODY_LINES = 3;

/** display:none · 크기 0 · 뷰포트 밖은 겹침 대상이 아니다(권한으로 숨긴 버튼도 여기로 빠진다). */
export function isOnScreen(box: Box, viewport: Viewport): boolean {
  if (box.w < 2 || box.h < 2) return false;
  if (viewport.w < 1 || viewport.h < 1) return false;
  return box.x < viewport.w && box.y < viewport.h && box.x + box.w > 0 && box.y + box.h > 0;
}

/** `[[slug|표시]]` · `**강조**` 를 겹침 말풍선용 평문으로. 영문 키·위키 표식을 화면에 안 남긴다. */
export function overlayPlainText(body: string): string {
  return body
    .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) =>
      (label ?? manualBySlug(slug)?.title ?? slug).trim(),
    )
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 말풍선 높이 — 짧은 글은 낮게. 화면에서 line-clamp 와 같은 줄 수. */
export function balloonHeight(body: string, width = BALLOON_W): number {
  const plain = overlayPlainText(body);
  const charsPerLine = Math.max(6, Math.floor((width - 24) / 12));
  const lines = Math.min(MAX_BODY_LINES, Math.max(1, Math.ceil(plain.length / charsPerLine)));
  return 12 + 18 + 4 + lines * 16;
}

export function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export function placeOverlay(anchors: OverlayAnchor[], vp: Viewport): PlacedCallout[] {
  if (vp.w < 1 || vp.h < 1) return [];
  const items = [...anchors]
    .sort((a, b) => a.n - b.n)
    .map((a) => ({ ...a, body: overlayPlainText(a.body), h: balloonHeight(a.body) }));
  const w = Math.min(BALLOON_W, Math.max(1, vp.w - 2 * PAD));
  const occupied: Box[] = [];
  const balloons = new Map<string, Box>();

  const top = items.filter((a) => a.box.y < TOP_BAND).sort((a, b) => a.box.x - b.box.x || a.n - b.n);
  const rest = items.filter((a) => a.box.y >= TOP_BAND);
  packAlongX(top, w, vp, occupied, balloons);
  const below = Math.max(PAD, ...[...balloons.values()].map((b) => b.y + b.h + GAP));
  const mid = vp.w / 2;
  const left = rest.filter((a) => a.box.x + a.box.w / 2 < mid).sort((a, b) => a.box.y - b.box.y || a.n - b.n);
  const right = rest.filter((a) => a.box.x + a.box.w / 2 >= mid).sort((a, b) => a.box.y - b.box.y || a.n - b.n);
  packColumn(left, PAD, below, w, vp, occupied, balloons, 1);
  packColumn(right, Math.max(PAD, vp.w - w - PAD), below, w, vp, occupied, balloons, -1);

  const pills: Box[] = [];
  return items.map((a) => {
    const balloon = balloons.get(a.key) ?? clampBox({ x: PAD, y: PAD, w, h: a.h }, vp);
    const pill = placePill(a.box, vp, pills);
    pills.push({ ...pill, w: PILL_SIZE, h: PILL_SIZE });
    return { key: a.key, n: a.n, label: a.label, body: a.body, pill, balloon };
  });
}

function packAlongX(
  items: { key: string; box: Box; h: number }[],
  w: number,
  vp: Viewport,
  occupied: Box[],
  balloons: Map<string, Box>,
) {
  for (const a of items) {
    const preferX = clamp(a.box.x, PAD, Math.max(PAD, vp.w - w - PAD));
    const box = fitBox({ x: preferX, y: PAD, w, h: a.h }, vp, occupied, "row");
    occupied.push(box);
    balloons.set(a.key, box);
  }
}

function packColumn(
  items: { key: string; h: number }[],
  colX: number,
  startY: number,
  w: number,
  vp: Viewport,
  occupied: Box[],
  balloons: Map<string, Box>,
  dir: 1 | -1,
) {
  let y = startY;
  let x = colX;
  for (const a of items) {
    if (y + a.h > vp.h - PAD && startY + a.h <= vp.h - PAD) {
      x = clamp(colX + dir * (w + GAP), PAD, Math.max(PAD, vp.w - w - PAD));
      y = startY;
    }
    const box = fitBox({ x, y, w, h: a.h }, vp, occupied, "col");
    occupied.push(box);
    balloons.set(a.key, box);
    y = box.y + box.h + GAP;
    x = box.x;
  }
}

function fitBox(seed: Box, vp: Viewport, occupied: Box[], mode: "row" | "col"): Box {
  let cur = clampBox(seed, vp);
  if (overlapScore(cur, occupied) <= 0) return cur;
  const step = seed.h + GAP;
  if (mode === "row") {
    let x = seed.x;
    let y = seed.y;
    for (let i = 0; i < 16; i++) {
      x += seed.w + GAP;
      if (x + seed.w > vp.w - PAD) {
        x = PAD;
        y += step;
      }
      cur = clampBox({ x, y, w: seed.w, h: seed.h }, vp);
      if (overlapScore(cur, occupied) <= 0) return cur;
    }
    return cur;
  }
  for (let i = 1; i <= 16; i++) {
    cur = clampBox({ ...seed, y: seed.y + i * step }, vp);
    if (overlapScore(cur, occupied) <= 0) return cur;
  }
  for (let i = 1; i <= 16; i++) {
    cur = clampBox({ ...seed, y: seed.y - i * step }, vp);
    if (overlapScore(cur, occupied) <= 0) return cur;
  }
  return clampBox(seed, vp);
}

function placePill(box: Box, vp: Viewport, taken: Box[]): { x: number; y: number } {
  const cands = [
    { x: box.x - PILL_SIZE - 2, y: box.y - 2 },
    { x: box.x + box.w + 2, y: box.y - 2 },
    { x: box.x - PILL_SIZE - 2, y: box.y + box.h - PILL_SIZE },
    { x: box.x + box.w + 2, y: box.y + box.h - PILL_SIZE },
    { x: box.x, y: box.y - PILL_SIZE - 2 },
    { x: box.x + box.w - PILL_SIZE, y: box.y + box.h + 2 },
  ];
  for (const c of cands) {
    const p = { x: c.x, y: c.y, w: PILL_SIZE, h: PILL_SIZE };
    if (p.x < PAD || p.y < PAD || p.x + p.w > vp.w - PAD || p.y + p.h > vp.h - PAD) continue;
    if (overlapScore(p, taken) > 0) continue;
    return { x: c.x, y: c.y };
  }
  return {
    x: clamp(box.x - PILL_SIZE - 2, PAD, Math.max(PAD, vp.w - PILL_SIZE - PAD)),
    y: clamp(box.y, PAD, Math.max(PAD, vp.h - PILL_SIZE - PAD)),
  };
}

function overlapScore(box: Box, occupied: Box[]): number {
  return occupied.reduce((s, o) => s + overlapArea(box, o), 0);
}

function clampBox(b: Box, vp: Viewport): Box {
  const w = Math.min(b.w, Math.max(1, vp.w - 2 * PAD));
  const h = Math.min(b.h, Math.max(1, vp.h - 2 * PAD));
  return {
    x: clamp(b.x, PAD, Math.max(PAD, vp.w - w - PAD)),
    y: clamp(b.y, PAD, Math.max(PAD, vp.h - h - PAD)),
    w,
    h,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
