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

/**
 * 세로축 눈금 — 바닥부터 꼭대기까지 다섯 칸 안팎. 칸 = 보기 좋은 수(1·2·2.5·5 × 10^n) 중 다섯 칸을 넘지 않는 가장 작은 것이고, 값이 정수인
 * 축(사람·건·원·%)이라 **정수 칸만**(꼭대기 2면 0·1·2 — '0.4건' 같은 눈금이 서지 않게 · 리뷰 2026-10-21). 바닥은 칸의 배수로 내린다
 * (바닥 30·꼭대기 100 → 20·40·…·100 — 44·58 같은 눈금이 서지 않게). 돌려준 `bottom`이 축의 실제 바닥이다.
 */
export function axisScale(top: number, bottom = 0): { bottom: number; ticks: number[] } {
  const raw = Math.max((top - bottom) / 5, 1e-9);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? 10 * mag);
  const base = Math.floor(bottom / step) * step;
  const ticks: number[] = [];
  for (let v = base; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { bottom: base, ticks };
}

/** 눈금만(`axisScale`). */
export function axisTicks(top: number, bottom = 0): number[] {
  return axisScale(top, bottom).ticks;
}

/**
 * 값에 맞춘 세로축 바닥(비율 차트) — 가장 작은 값에서 꼭대기까지 폭의 1/10만큼 더 내려 10 단위로 내림 · 0 아래로는 안 간다.
 * 예: 91.2~97.5%(꼭대기 100) → 90 · 62% → 50. 바닥이 꼭대기와 너무 가까우면(폭 10 미만) 10 아래로 연다.
 */
export function axisFloor(min: number, top: number): number {
  if (!(min > 0)) return 0;
  const floor = Math.floor((min - (top - min) / 10) / 10) * 10;
  return Math.max(0, Math.min(floor, top - 10));
}

/**
 * 경계 달(YYYY-MM) **전** 점의 값을 비운다(null) — 선이 그 달부터 시작한다(그 전은 정확히 셀 수 없어 그리지 않는다).
 * 연도별(키 4자리)은 연말 날짜로 판정한다(그해 말이 경계 전이면 비움). 경계가 없으면 그대로.
 */
export function maskBefore(points: readonly { key: string; date: string; count: number }[], fromMonth: string | null): (number | null)[] {
  if (!fromMonth) return points.map((p) => p.count);
  return points.map((p) => (p.date.slice(0, 7) >= fromMonth ? p.count : null));
}

/**
 * 쌓은 막대의 칸별 합 — 스택 id → 칸마다 합. 그 칸의 값이 모두 null이면 null(정확히 셀 수 없는 칸 — 0으로 세우지 않는다).
 * 세로축 꼭대기와 막대 위 합 숫자가 같은 값을 쓴다.
 */
export function stackTotals(series: readonly { stack?: string; values: readonly (number | null)[] }[], length: number): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  for (const s of series) {
    if (!s.stack) continue;
    const acc = out.get(s.stack) ?? Array.from({ length }, (): number | null => null);
    for (let i = 0; i < length; i++) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      acc[i] = (acc[i] ?? 0) + v;
    }
    out.set(s.stack, acc);
  }
  return out;
}

/** 글자 폭 어림(14px 글꼴) — 한글 14 · 숫자·영문 8 · 공백 4. 기준 경계 문구 자리를 잡는 데 쓴다. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[가-힣]/.test(ch) ? 14 : ch === " " ? 4 : 8;
  return w;
}
