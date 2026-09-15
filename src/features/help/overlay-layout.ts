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
  const occupied: Box[] = [];
  const pills: Box[] = [];
  return [...anchors]
    .sort((a, b) => a.n - b.n)
    .map((a) => {
      const body = overlayPlainText(a.body);
      const h = balloonHeight(a.body);
      const w = balloonWidth(a.box, vp);
      const pill = placePill(a.box, vp, pills);
      pills.push({ ...pill, w: PILL_SIZE, h: PILL_SIZE });
      const balloon = placeBalloon(a.box, w, h, vp, occupied);
      occupied.push(balloon);
      return { key: a.key, n: a.n, label: a.label, body, pill, balloon };
    });
}

/** 넓은 칸(운영실 카드)은 칸 너비에 맞춰 옆 칸을 안 덮는다. */
function balloonWidth(box: Box, vp: Viewport): number {
  const cap = Math.max(1, vp.w - 2 * PAD);
  if (box.w >= 160) return Math.min(BALLOON_W, Math.max(160, box.w), cap);
  return Math.min(BALLOON_W, cap);
}

function placeBalloon(box: Box, w: number, h: number, vp: Viewport, occupied: Box[]): Box {
  const xs = [box.x, box.x + (box.w - w) / 2, box.x + box.w - w, box.x + box.w + GAP, box.x - w - GAP];
  const ys = [box.y + box.h + GAP, box.y - h - GAP, box.y, box.y + box.h / 2 - h / 2];
  let best: Box | null = null;
  let bestScore = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const c = clampBox({ x, y, w, h }, vp);
      const s = scoreBalloon(c, box, occupied);
      if (s < bestScore) {
        best = c;
        bestScore = s;
      }
    }
  }
  const seed = best ?? clampBox({ x: box.x, y: box.y + box.h + GAP, w, h }, vp);
  if (overlapScore(seed, occupied) <= 0) return seed;
  const step = h + GAP;
  for (let i = 1; i <= 14; i++) {
    const down = clampBox({ ...seed, y: seed.y + i * step }, vp);
    if (overlapScore(down, occupied) <= 0) return down;
  }
  for (let i = 1; i <= 14; i++) {
    const up = clampBox({ ...seed, y: seed.y - i * step }, vp);
    if (overlapScore(up, occupied) <= 0) return up;
  }
  const xStep = w + GAP;
  for (let i = 1; i <= 6; i++) {
    const right = clampBox({ ...seed, x: seed.x + i * xStep }, vp);
    if (overlapScore(right, occupied) <= 0) return right;
    const left = clampBox({ ...seed, x: seed.x - i * xStep }, vp);
    if (overlapScore(left, occupied) <= 0) return left;
  }
  return seed;
}

function scoreBalloon(c: Box, box: Box, occupied: Box[]): number {
  const overlap = overlapScore(c, occupied);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const bx = box.x + box.w / 2;
  const by = box.y + box.h / 2;
  const shareX = overlapArea({ x: c.x, y: 0, w: c.w, h: 1 }, { x: box.x, y: 0, w: box.w, h: 1 });
  return overlap * 80 + Math.hypot(cx - bx, cy - by) - shareX * 0.4;
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
