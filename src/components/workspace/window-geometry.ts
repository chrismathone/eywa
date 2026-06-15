/**
 * 윈도우 기하 — 순수 함수(테스트 강제). DOM·React 무관.
 * 좌표계: 캔버스 로컬(0,0 = 캔버스 좌상단). bounds = 캔버스 크기.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
// 절반(left/right/top/bottom)·최대화(max)·1/4 모서리(tl/tr/bl/br)
export type SnapZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "max"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | null;

export const MIN_W = 360;
export const MIN_H = 280;

/** 캔버스 안으로 + 최소 크기 보장하여 보정. */
export function clampRect(rect: Rect, bounds: Bounds): Rect {
  const w = Math.min(Math.max(rect.w, MIN_W), Math.max(MIN_W, bounds.width));
  const h = Math.min(Math.max(rect.h, MIN_H), Math.max(MIN_H, bounds.height));
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, bounds.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, bounds.height - h));
  return { x, y, w, h };
}

/** 새 창 기본 위치 — 인덱스만큼 cascade 오프셋(겹쳐 쌓이지 않게), 화면 넘으면 wrap. */
export function cascadeNext(count: number, bounds: Bounds): Rect {
  const w = Math.min(480, Math.max(MIN_W, bounds.width - 40));
  const h = Math.min(560, Math.max(MIN_H, bounds.height - 40));
  const step = 28;
  const span = Math.max(0, Math.min(bounds.width - w, bounds.height - h) - 24);
  const offset = span > 0 ? (count * step) % (span + 1) : 0;
  return clampRect({ x: 24 + offset, y: 24 + offset, w, h }, bounds);
}

/** 스냅 존 → 목표 사각형(좌/우 절반·전체 최대화·1/4 모서리). */
export function snapTarget(zone: SnapZone, bounds: Bounds): Rect | null {
  const hw = Math.round(bounds.width / 2);
  const hh = Math.round(bounds.height / 2);
  switch (zone) {
    case "left":
      return { x: 0, y: 0, w: hw, h: bounds.height };
    case "right":
      return { x: bounds.width - hw, y: 0, w: hw, h: bounds.height };
    case "top":
      return { x: 0, y: 0, w: bounds.width, h: hh };
    case "bottom":
      return { x: 0, y: bounds.height - hh, w: bounds.width, h: hh };
    case "max":
      return { x: 0, y: 0, w: bounds.width, h: bounds.height };
    case "tl":
      return { x: 0, y: 0, w: hw, h: hh };
    case "tr":
      return { x: bounds.width - hw, y: 0, w: hw, h: hh };
    case "bl":
      return { x: 0, y: bounds.height - hh, w: hw, h: hh };
    case "br":
      return { x: bounds.width - hw, y: bounds.height - hh, w: hw, h: hh };
    default:
      return null;
  }
}

/**
 * 드래그 포인터가 캔버스 가장자리 근처면 스냅 존 반환.
 * 우선순위: 모서리(1/4) > 상/하/좌/우 가장자리(절반). 좌/우 가장자리에 닿은 채
 * 상·하 corner 밴드 안이면 1/4, 가운데면 절반. (최대화는 드래그 아닌 버튼/더블클릭)
 */
export function snapZoneForPoint(
  px: number,
  py: number,
  bounds: Bounds,
  edge = 24,
  corner = 80,
): SnapZone {
  const nearLeft = px <= edge;
  const nearRight = px >= bounds.width - edge;
  if (nearLeft && py <= corner) return "tl";
  if (nearRight && py <= corner) return "tr";
  if (nearLeft && py >= bounds.height - corner) return "bl";
  if (nearRight && py >= bounds.height - corner) return "br";
  if (py <= edge) return "top";
  if (py >= bounds.height - edge) return "bottom";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return null;
}

export type LayoutTemplate = "split" | "stack" | "thirds";

/**
 * 레이아웃 템플릿 → 슬롯 사각형 배열(슬롯0 = 앵커 위치). Snap Assist 자동 타일링용.
 * anchorSide = 앵커가 놓인 쪽. split=좌우 절반, stack=앵커 full-half + 반대 상/하 ¼(1+2),
 * thirds=세로 3컬럼(앵커가 자기 쪽 끝 컬럼). 각 슬롯 clampRect.
 */
export function layoutSlots(
  template: LayoutTemplate,
  bounds: Bounds,
  anchorSide: "left" | "right",
): Rect[] {
  const W = bounds.width;
  const H = bounds.height;
  const hw = Math.round(W / 2);
  const hh = Math.round(H / 2);
  const left = anchorSide === "left";
  let slots: Rect[];
  if (template === "split") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const b = left ? { x: W - hw, y: 0, w: hw, h: H } : { x: 0, y: 0, w: hw, h: H };
    slots = [a, b];
  } else if (template === "stack") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const sx = left ? W - hw : 0;
    slots = [a, { x: sx, y: 0, w: hw, h: hh }, { x: sx, y: H - hh, w: hw, h: hh }];
  } else {
    const t = Math.round(W / 3);
    const cols = [
      { x: 0, y: 0, w: t, h: H },
      { x: t, y: 0, w: W - 2 * t, h: H },
      { x: W - t, y: 0, w: t, h: H },
    ];
    slots = left ? [cols[0], cols[1], cols[2]] : [cols[2], cols[1], cols[0]];
  }
  return slots.map((r) => clampRect(r, bounds));
}

/** 8방향 핸들 리사이즈 — 델타 적용 + 최소크기(이동변 보정) + 캔버스 clamp. */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Bounds,
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;

  if (handle.includes("e")) right = rect.x + rect.w + dx;
  if (handle.includes("s")) bottom = rect.y + rect.h + dy;
  if (handle.includes("w")) left = rect.x + dx;
  if (handle.includes("n")) top = rect.y + dy;

  if (right - left < MIN_W) {
    if (handle.includes("w")) left = right - MIN_W;
    else right = left + MIN_W;
  }
  if (bottom - top < MIN_H) {
    if (handle.includes("n")) top = bottom - MIN_H;
    else bottom = top + MIN_H;
  }

  return clampRect({ x: left, y: top, w: right - left, h: bottom - top }, bounds);
}

/** id를 z-order 맨 앞(배열 끝)으로. idempotent. */
export function bringToFront(order: string[], id: string): string[] {
  return [...order.filter((i) => i !== id), id];
}
