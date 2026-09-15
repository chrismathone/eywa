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

/**
 * 말풍선 치수 — 🔴 **화면(`screen-help-overlay.tsx`)의 실제 클래스에서 온 값**이다. 한쪽만 고치면
 * 글이 상자 밖으로 넘치거나(`overflow-hidden`이라 **소리 없이 잘린다**) 빈 자리가 남는다.
 * `px-2.5`(10) · `py-1.5`(6) · 제목 한 줄 · `mt-0.5`(2) · 본문 `text-xs leading-snug`.
 * ⚠️ `--text-xs`는 이 앱에서 **14px**이다(globals.css — v5 타입 스케일). Tailwind 기본값 12px로 세면
 *    줄이 모자라 문장이 중간에서 끊긴다(원장 제보 2026-09-15 *"너무 안맞네 일부가"*).
 */
const PAD_X = 10;
const PAD_Y = 6;
const LABEL_H = 20;
const LABEL_GAP = 2;
const BODY_LINE_H = 20;
/** 한 글자 폭 — 한글 14px는 거의 전각이고 `break-keep`이라 줄 끝이 일찍 꺾인다. 넉넉하게 잡는다(모자라면 잘린다). */
const BODY_CHAR_W = 15;
/** 말풍선이 화면을 통째로 덮지 않게 — 여기 걸리면 그 글만 줄여 적어야 한다는 신호다. */
const MAX_BALLOON_H_RATIO = 0.5;

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

/**
 * 말풍선 높이 — **글 전체가 들어가는** 높이다. 짧은 글은 낮게.
 *
 * 🔴 줄 수에 상한을 두지 말 것 — 예전엔 3줄로 잘랐는데(`line-clamp-3`) 설명이 두세 문장이라
 * 대부분이 *"…전체를 못"* 처럼 **문장 중간에서 끊겼다**(원장 제보 2026-09-15). 도움말이 말을 하다 마는 건
 * 도움말이 아니다. 화면이 넘치는 게 걱정이면 상한을 올릴 게 아니라 **그 설명을 짧게** 써야 한다.
 */
export function balloonHeight(body: string, width = BALLOON_W, viewportH = Infinity): number {
  const plain = overlayPlainText(body);
  const charsPerLine = Math.max(6, Math.floor((width - 2 * PAD_X) / BODY_CHAR_W));
  const lines = Math.max(1, Math.ceil(plain.length / charsPerLine));
  const h = 2 * PAD_Y + LABEL_H + LABEL_GAP + lines * BODY_LINE_H;
  const cap = Number.isFinite(viewportH) ? Math.max(80, viewportH * MAX_BALLOON_H_RATIO) : Infinity;
  return Math.min(h, cap);
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
      const w = balloonWidth(a.box, vp);
      // 🔴 높이는 **그 폭으로** 센다 — 넓은 창에서 폭만 넓히고 높이를 기본 폭으로 세면 상자가 과하게 높아지고,
      //    반대로 좁은 창에서 기본 폭으로 세면 글이 넘쳐 잘린다.
      const h = balloonHeight(a.body, w, vp.h);
      const pill = placePill(a.box, vp, pills);
      pills.push({ ...pill, w: PILL_SIZE, h: PILL_SIZE });
      const balloon = placeBalloon(a.box, w, h, vp, occupied);
      occupied.push(balloon);
      return { key: a.key, n: a.n, label: a.label, body, pill, balloon };
    });
}

/**
 * 넓은 칸(운영실 카드)은 칸 너비에 맞춰 옆 칸을 안 덮는다.
 * ⚠️ **창이 넓으면 말풍선도 조금 넓힌다**(원장 2026-09-15 *"창 크기에 따라 잘 맞춰야겠는데"*) — 폭이 넓으면
 * 같은 글이 적은 줄로 들어가 세로로 덜 퍼지고, 그만큼 서로 덜 겹친다. 좁은 창에선 기본 220 그대로다.
 */
function balloonWidth(box: Box, vp: Viewport): number {
  const cap = Math.max(1, vp.w - 2 * PAD);
  const base = clamp(Math.round(vp.w * 0.15), BALLOON_W, 300);
  if (box.w >= 160) return Math.min(base, Math.max(160, box.w), cap);
  return Math.min(base, cap);
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

  // 씨앗 자리가 막혔다 — 화면 전체를 성기게 훑어 **빈 자리 중 원래 칸에 가장 가까운 곳**을 고른다.
  // 🔴 예전엔 씨앗에서 한 상자씩(`h + GAP`) 아래·위·옆으로만 뛰었는데, 말풍선 높이가 제각각이라
  //    그 격자에 안 맞는 틈이 통째로 버려졌다(글을 다 담느라 상자가 높아지자 16개가 안 눕혀졌다).
  const SCAN_Y = 24;
  const SCAN_X = Math.max(40, Math.round(w / 3));
  let free: Box | null = null;
  let freeDist = Infinity;
  const bx = box.x + box.w / 2;
  const by = box.y + box.h / 2;
  for (let y = PAD; y <= Math.max(PAD, vp.h - h - PAD); y += SCAN_Y) {
    for (let x = PAD; x <= Math.max(PAD, vp.w - w - PAD); x += SCAN_X) {
      const c = { x, y, w, h };
      if (overlapScore(c, occupied) > 0) continue;
      const d = Math.hypot(c.x + c.w / 2 - bx, c.y + c.h / 2 - by);
      if (d < freeDist) {
        free = c;
        freeDist = d;
      }
    }
  }
  return free ?? seed;
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
