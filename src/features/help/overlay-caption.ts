import { HOVER_CARD_MAX_H, HOVER_CARD_WIDTH } from "@/components/hover-tip/card-style";
import { overlapArea, overlayPlainText, PILL_SIZE, type Box, type Viewport } from "./overlay-layout";

export type Stem = { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number };
export type PlacedCaption = { card: Box; stem: Stem | null };

const PAD = 8;
const GAP = 8;
const CARD_PAD = 12;
const LABEL_LINE_H = 21;
const LABEL_NUM_W = 18;
const LABEL_GAP = 2;
const BODY_LINE_H = 20;
const BODY_CHAR_W = 15;
const FOOTER_GAP = 8;
const FOOTER_H = 21;
const STEM_MIN = 16;

export function captionSize(
  label: string,
  body: string,
  vp: Viewport,
  width = HOVER_CARD_WIDTH,
): { w: number; contentH: number; displayH: number } {
  const w = Math.min(width, Math.max(1, vp.w - 2 * PAD));
  const content = Math.max(1, w - 2 * CARD_PAD);
  const charsPerLine = Math.max(6, Math.floor(content / BODY_CHAR_W));
  const plain = overlayPlainText(body);
  const bodyLines = Math.max(1, Math.ceil(plain.length / charsPerLine));
  const labelLines = Math.max(
    1,
    Math.ceil((label.length * BODY_CHAR_W + LABEL_NUM_W) / content),
  );
  const contentH =
    2 * CARD_PAD +
    labelLines * LABEL_LINE_H +
    LABEL_GAP +
    bodyLines * BODY_LINE_H +
    FOOTER_GAP +
    FOOTER_H;
  const capH = Math.min(HOVER_CARD_MAX_H, Math.max(80, vp.h * 0.5));
  return { w, contentH, displayH: Math.min(contentH, capH) };
}

export function placeCaption(
  target: Box,
  pill: { x: number; y: number },
  vp: Viewport,
  label: string,
  body: string,
  occupiedPills: Box[],
): PlacedCaption {
  const { w, displayH: h } = captionSize(label, body, vp);
  const ax = pill.x < target.x + target.w / 2 ? target.x : target.x + target.w - w;
  const ay = target.y + (target.h - h) / 2;
  const dock = { x: ax, y: vp.h - h - PAD, w, h };
  const rest = [
    { x: ax, y: target.y + target.h + GAP, w, h },
    { x: ax, y: target.y - h - GAP, w, h },
    { x: target.x + target.w + GAP, y: ay, w, h },
    { x: target.x - w - GAP, y: ay, w, h },
  ];
  const order = target.w > vp.w * 0.6 ? [dock, ...rest] : rest;
  for (const raw of order) {
    const card = clampBox(raw, vp);
    if (occupiedPills.every((p) => overlapArea(card, p) === 0)) {
      return { card, stem: makeStem(pill, card) };
    }
  }
  const card = clampBox(dock, vp);
  return { card, stem: makeStem(pill, card) };
}

function makeStem(pill: { x: number; y: number }, card: Box): Stem | null {
  const x1 = pill.x + PILL_SIZE / 2;
  const y1 = pill.y + PILL_SIZE / 2;
  const end = nearestEdgeMid(card, x1, y1);
  if (Math.hypot(end.x - x1, end.y - y1) <= STEM_MIN) return null;
  return { x1, y1, x2: end.x, y2: end.y, cx: x1, cy: end.y };
}

function nearestEdgeMid(card: Box, px: number, py: number): { x: number; y: number } {
  const mids = [
    { x: card.x + card.w / 2, y: card.y },
    { x: card.x + card.w / 2, y: card.y + card.h },
    { x: card.x, y: card.y + card.h / 2 },
    { x: card.x + card.w, y: card.y + card.h / 2 },
  ];
  let best = mids[0]!;
  let bestD = Infinity;
  for (const m of mids) {
    const d = Math.hypot(m.x - px, m.y - py);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
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
