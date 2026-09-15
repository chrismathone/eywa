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
const GAP = 8;
const PAD = 8;
export const BALLOON_W = 260;
export const BALLOON_H = 96;

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

export function placeOverlay(anchors: OverlayAnchor[], viewport: Viewport): PlacedCallout[] {
  const placed: PlacedCallout[] = [];
  for (const a of anchors) {
    const pill = pillPos(a.box, viewport);
    const balloon = balloonPos(a.box, viewport, placed.map((p) => p.balloon));
    placed.push({
      key: a.key,
      n: a.n,
      label: a.label,
      body: overlayPlainText(a.body),
      pill,
      balloon,
    });
  }
  return placed;
}

function pillPos(box: Box, vp: Viewport): { x: number; y: number } {
  // 요소 왼쪽 위 모서리 — 알약이 컨트롤 한가운데를 가리지 않게 반 칸 바깥.
  const x = clamp(box.x - PILL_SIZE / 2, PAD, Math.max(PAD, vp.w - PILL_SIZE - PAD));
  const y = clamp(box.y - PILL_SIZE / 2, PAD, Math.max(PAD, vp.h - PILL_SIZE - PAD));
  return { x, y };
}

function balloonPos(box: Box, vp: Viewport, occupied: Box[]): Box {
  const candidates: Box[] = [
    { x: box.x + box.w + GAP, y: box.y, w: BALLOON_W, h: BALLOON_H },
    { x: box.x - BALLOON_W - GAP, y: box.y, w: BALLOON_W, h: BALLOON_H },
    { x: box.x, y: box.y + box.h + GAP, w: BALLOON_W, h: BALLOON_H },
    { x: box.x, y: box.y - BALLOON_H - GAP, w: BALLOON_W, h: BALLOON_H },
  ].map((c) => clampBox(c, vp));

  let best = candidates[0]!;
  let bestScore = overlapScore(best, occupied);
  for (const c of candidates.slice(1)) {
    const s = overlapScore(c, occupied);
    if (s < bestScore) {
      best = c;
      bestScore = s;
    }
  }
  if (bestScore <= 0) return best;
  return nudgeOff(best, vp, occupied);
}

function nudgeOff(box: Box, vp: Viewport, occupied: Box[]): Box {
  let cur = box;
  for (let i = 0; i < 8; i++) {
    if (overlapScore(cur, occupied) <= 0) return cur;
    cur = clampBox({ ...cur, y: cur.y + BALLOON_H + GAP }, vp);
  }
  return cur;
}

function overlapScore(box: Box, occupied: Box[]): number {
  let s = 0;
  for (const o of occupied) {
    const x = Math.max(0, Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x));
    const y = Math.max(0, Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y));
    s += x * y;
  }
  return s;
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
