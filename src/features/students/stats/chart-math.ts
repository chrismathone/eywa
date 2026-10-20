/**
 * 원생 통계 그래프의 순수 계산 — 눈금 꼭대기 · 선 끝 라벨 겹침 피하기 · 경계 전 값 비우기 · 라벨 폭 어림(Vitest).
 * 그리는 일은 `trend-chart-impl.tsx`(recharts)가 한다. 여기는 숫자만 만든다.
 */

/** 세로축 꼭대기 — 최댓값보다 조금 위의 '보기 좋은' 수(1·2·2.5·5·10 × 10^n). 0이면 10. */
export function niceTop(max: number): number {
  if (!(max > 0)) return 10;
  const raw = max * 1.08;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10;
  return step * mag;
}

/** 세로축 눈금 — 0부터 꼭대기까지 다섯 칸(꼭대기가 1·2·2.5·5 × 10^n이라 칸 값이 늘 정수다 · 10 → 2씩). */
export function axisTicks(top: number): number[] {
  const step = top / 5;
  return Array.from({ length: 6 }, (_, i) => Math.round(step * i * 100) / 100);
}

/**
 * 경계 달(YYYY-MM) **전** 점의 값을 비운다(null) — 선이 그 달부터 시작한다(그 전은 정확히 셀 수 없어 그리지 않는다).
 * 연도별(키 4자리)은 연말 날짜로 판정한다(그해 말이 경계 전이면 비움). 경계가 없으면 그대로.
 */
export function maskBefore(points: readonly { key: string; date: string; count: number }[], fromMonth: string | null): (number | null)[] {
  if (!fromMonth) return points.map((p) => p.count);
  return points.map((p) => (p.date.slice(0, 7) >= fromMonth ? p.count : null));
}

/** 마지막으로 값이 있는 칸(없으면 -1). */
export function lastIndexWithValue(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return i;
  return -1;
}

/**
 * 선 끝 라벨의 세로 위치 조정 — 선마다 마지막 값의 화면 높이(y)를 구해, 가까운 라벨끼리 `gap`px 이상 벌린다.
 * 위에서부터 차례로 내려 밀고, 바닥을 넘으면 위로 되민다. 돌려주는 값 = 원래 점 위치에서 더할 dy(px).
 */
export function endLabelOffsets(
  lines: readonly { key: string; value: number }[],
  scale: { top: number; plotTop: number; plotHeight: number },
  gap = 18,
): Map<string, number> {
  const y = (v: number) => scale.plotTop + (1 - v / scale.top) * scale.plotHeight;
  const items = lines.map((l) => ({ key: l.key, y0: y(l.value), y: y(l.value) })).sort((a, b) => a.y0 - b.y0);
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.y - items[i - 1]!.y < gap) items[i]!.y = items[i - 1]!.y + gap;
  }
  const bottom = scale.plotTop + scale.plotHeight;
  const last = items.at(-1);
  if (last && last.y > bottom) {
    last.y = bottom;
    for (let i = items.length - 2; i >= 0; i--) {
      if (items[i + 1]!.y - items[i]!.y < gap) items[i]!.y = items[i + 1]!.y - gap;
    }
  }
  return new Map(items.map((it) => [it.key, it.y - it.y0]));
}

/** 글자 폭 어림(14px 글꼴) — 한글 14 · 숫자·영문 8 · 공백 4. 선 끝 라벨 자리(오른쪽 여백)를 잡는 데 쓴다. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[가-힣]/.test(ch) ? 14 : ch === " " ? 4 : 8;
  return w;
}
