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
export type PlacedPill = {
  key: string;
  n: number;
  label: string;
  body: string;
  pill: { x: number; y: number };
  box: Box;
};

export const PILL_SIZE = 22;
const PAD = 8;

/** display:none · 크기 0 · 뷰포트 밖은 겹침 대상이 아니다(권한으로 숨긴 버튼도 여기로 빠진다). */
export function isOnScreen(box: Box, viewport: Viewport): boolean {
  if (box.w < 2 || box.h < 2) return false;
  if (viewport.w < 1 || viewport.h < 1) return false;
  return box.x < viewport.w && box.y < viewport.h && box.x + box.w > 0 && box.y + box.h > 0;
}

/** `[[slug|표시]]` · `**강조**` 를 겹침 캡션용 평문으로. 영문 키·위키 표식을 화면에 안 남긴다. */
export function overlayPlainText(body: string): string {
  return body
    .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) =>
      (label ?? manualBySlug(slug)?.title ?? slug).trim(),
    )
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export function holeRect(box: Box, vp: Viewport, pad = 6): Box {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(vp.w - x, box.w + pad * 2);
  const h = Math.min(vp.h - y, box.h + pad * 2);
  return { x, y, w: Math.max(w, 32), h: Math.max(h, 32) };
}

export function placePills(anchors: OverlayAnchor[], vp: Viewport): PlacedPill[] {
  if (vp.w < 1 || vp.h < 1) return [];
  const taken: Box[] = [];
  return [...anchors]
    .sort((a, b) => a.n - b.n)
    .map((a) => {
      const pill = placePill(a.box, vp, taken);
      taken.push({ x: pill.x, y: pill.y, w: PILL_SIZE, h: PILL_SIZE });
      return {
        key: a.key,
        n: a.n,
        label: a.label,
        body: overlayPlainText(a.body),
        pill,
        box: a.box,
      };
    });
}

/** 컨트롤 한가운데를 덮지 않는 모서리 후보. */
export function placePill(box: Box, vp: Viewport, taken: Box[]): { x: number; y: number } {
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
