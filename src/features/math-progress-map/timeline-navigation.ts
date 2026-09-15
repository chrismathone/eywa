export type MonthBounds = { month: number; top: number; bottom: number };

/** 긴 월과 짧은 월을 같은 기준으로 비교한다. 경계에서 거리가 같으면 현재 선택을 유지한다. */
export function monthNearestCenter(bounds: readonly MonthBounds[], center: number, current: number): number {
  return bounds.reduce((best, item) => {
    const distance = Math.abs((item.top + item.bottom) / 2 - center);
    if (distance < best.distance - 1 || (Math.abs(distance - best.distance) <= 1 && item.month === current)) return { month: item.month, distance };
    return best;
  }, { month: current, distance: Infinity }).month;
}

export function wheelPixels(delta: number, mode: number, viewportHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
}
