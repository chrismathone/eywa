export type MonthBounds = { month: number; top: number; bottom: number };

/** 긴 월과 짧은 월을 같은 기준으로 비교한다. 경계에서 거리가 같으면 현재 선택을 유지한다. */
export function monthNearestCenter(bounds: readonly MonthBounds[], center: number, current: number): number {
  const containing = bounds.find((item) => item.top <= center && center < item.bottom);
  if (containing) return containing.month;
  return bounds.reduce((best, item) => {
    const distance = Math.abs((item.top + item.bottom) / 2 - center);
    if (distance < best.distance - 1 || (Math.abs(distance - best.distance) <= 1 && item.month === current)) return { month: item.month, distance };
    return best;
  }, { month: current, distance: Infinity }).month;
}

/** 스크롤 양 끝에서는 중앙에 오지 못하는 첫 월·마지막 월까지 선택한다. */
export function monthAtScrollPosition(bounds: readonly MonthBounds[], center: number, current: number, scrollTop: number, maxScrollTop: number): number {
  // 내용이 한 화면에 다 들어오면 위·아래 끝을 구분할 수 없으므로 중앙 기준을 유지한다.
  if (bounds.length && maxScrollTop > 1) {
    if (scrollTop <= 1) return bounds.reduce((first, item) => item.top < first.top ? item : first).month;
    if (maxScrollTop - scrollTop <= 1) return bounds.reduce((last, item) => item.bottom > last.bottom ? item : last).month;
  }
  return monthNearestCenter(bounds, center, current);
}

export function wheelPixels(delta: number, mode: number, viewportHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
}
