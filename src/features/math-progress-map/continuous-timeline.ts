/** 12월→1월도 차이가 1인 연속 월 좌표. */
export function monthPosition(year: number, month: number): number {
  return year * 12 + month - 1;
}

export function periodAt(position: number): { year: number; month: number } {
  const index = Math.round(position);
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

/** 선택한 달 앞 5개월과 뒤 6개월. 원의 반대편부터 다음 해의 달로 이어진다. */
export function rollingPeriods(position: number) {
  return Array.from({ length: 12 }, (_, index) => periodAt(position + index - 5)).sort((a, b) => a.month - b.month);
}

/** 12시 방향 경계를 지날 때도 드래그가 한 바퀴 튀지 않는다. */
export function turnDelta(previous: number, next: number): number {
  return ((next - previous + 540) % 360) - 180;
}
