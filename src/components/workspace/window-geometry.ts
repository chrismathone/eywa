/**
 * 윈도우 기하 — 순수 함수(테스트 강제). DOM·React 무관.
 * 좌표계: 캔버스 로컬(0,0 = 캔버스 좌상단). bounds = 캔버스 크기.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type SnapZone = "left" | "right" | "max" | null;

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

/** 스냅 존 → 목표 사각형(좌/우 절반·전체 최대화). */
export function snapTarget(zone: SnapZone, bounds: Bounds): Rect | null {
  if (zone === "left") return { x: 0, y: 0, w: Math.round(bounds.width / 2), h: bounds.height };
  if (zone === "right") {
    const w = Math.round(bounds.width / 2);
    return { x: bounds.width - w, y: 0, w, h: bounds.height };
  }
  if (zone === "max") return { x: 0, y: 0, w: bounds.width, h: bounds.height };
  return null;
}

/** 드래그 포인터가 캔버스 가장자리 근처면 스냅 존 반환(상단 우선). */
export function snapZoneForPoint(px: number, py: number, bounds: Bounds, edge = 24): SnapZone {
  if (py <= edge) return "max";
  if (px <= edge) return "left";
  if (px >= bounds.width - edge) return "right";
  return null;
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
