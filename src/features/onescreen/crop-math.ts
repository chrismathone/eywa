/**
 * 사진 자르기 네모(2026-09-11, 영어 보고서 글 속 사진) — 순수 함수(Vitest로 잠금).
 *
 * 🔑 네모는 **비율(0~1)** 좌표다 — 화면에 그린 크기와 무관해서, 창 크기가 바뀌거나 폰·PC가 달라도 같은 부분이 잘린다.
 *    원본 픽셀로는 자르는 순간 한 번만 옮긴다(`cropPixels`).
 * 🔑 모서리를 끌면 **맞은편 모서리를 붙잡고** 늘이고 줄인다. 가운데를 끌면 크기 그대로 옮긴다. 어느 쪽이든 그림 밖으로 안 나간다.
 */
export type CropRect = { x: number; y: number; w: number; h: number };
export type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
/** 가장 작은 네모(각 변의 비율) — 손가락으로 다시 잡을 수 있는 크기. */
export const MIN_CROP = 0.08;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** 끌기 한 번 — 시작 네모 + 끈 거리(비율) → 새 네모. */
export function dragCrop(start: CropRect, handle: CropHandle, dx: number, dy: number, min = MIN_CROP): CropRect {
  const ddx = finite(dx);
  const ddy = finite(dy);
  if (handle === "move") {
    return {
      x: clamp(start.x + ddx, 0, 1 - start.w),
      y: clamp(start.y + ddy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle === "nw" || handle === "sw") left = clamp(left + ddx, 0, right - min);
  else right = clamp(right + ddx, left + min, 1);
  if (handle === "nw" || handle === "ne") top = clamp(top + ddy, 0, bottom - min);
  else bottom = clamp(bottom + ddy, top + min, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 사실상 전체인가 — 그러면 자르지 않고 원본을 그대로 넘긴다(다시 인코딩해 화질을 깎지 않게). */
export function isFullCrop(r: CropRect, eps = 0.005): boolean {
  return r.x <= eps && r.y <= eps && r.x + r.w >= 1 - eps && r.y + r.h >= 1 - eps;
}

/** 원본 픽셀 네모 — 반올림해도 그림 안, 최소 1px. */
export function cropPixels(
  r: CropRect,
  natural: { w: number; h: number },
): { sx: number; sy: number; sw: number; sh: number } {
  const W = Math.max(1, Math.round(finite(natural.w)));
  const H = Math.max(1, Math.round(finite(natural.h)));
  const sx = clamp(Math.round(finite(r.x) * W), 0, W - 1);
  const sy = clamp(Math.round(finite(r.y) * H), 0, H - 1);
  const ex = clamp(Math.round(finite(r.x + r.w) * W), sx + 1, W);
  const ey = clamp(Math.round(finite(r.y + r.h) * H), sy + 1, H);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}
