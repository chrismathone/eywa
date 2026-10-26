import { OPERATION_METRICS } from "../model/config";
import type { TrendPoint } from "../model/score-trend";

/** 화면이 받는 점. 오래된 저장본·테스트처럼 구성값이 없으면 그 달 증감 전체를 운영 기여로 그린다. */
export type ChartPoint = Pick<TrendPoint, "month" | "total" | "change"> & Partial<Omit<TrendPoint, "month" | "total" | "change">>;
export type SegmentKind = "operations" | "participation" | "correction";
export type Segment = { key: string; kind: SegmentKind; from: number; to: number };
/** 운영 = 학원색, 학습·참여 = 같은 색의 옅은 단계, 정정 = 주의색. 차트·범례·달 해설이 같은 값을 쓴다. */
export const SEGMENT_FILL: Record<SegmentKind, string> = { operations: "var(--primary)",
  participation: "color-mix(in srgb, var(--primary) 52%, var(--card))", correction: "var(--amber)" };

/** 위 = 누적 선, 아래 = 그 달 증감 막대. 두 판이 같은 가로 칸(달)을 나눠 쓴다. */
export const TREND_BOX = { left: 58, right: 14, top: 28, line: 92, gap: 54, bars: 132, axis: 30 } as const;
export const TREND_HEIGHT = TREND_BOX.top + TREND_BOX.line + TREND_BOX.gap + TREND_BOX.bars + TREND_BOX.axis;

const ORDER: SegmentKind[] = ["operations", "participation", "correction"];
/**
 * 항목별로 양수는 0 위로, 음수(그 달 환불·정정)는 0 아래로 쌓는다. 묶음 합계로 쌓으면 같은 달의 +15와 −5가
 * +10 하나로 상쇄돼 감소가 사라진다. 색은 늘 종류(운영·학습·정정)로, 증감 방향은 0선 위아래로 읽는다.
 */
export function stackSegments(p: ChartPoint): Segment[] {
  const parts: [string, SegmentKind, number][] = p.items ? p.items.flatMap((item) => [
    [item.metric, (OPERATION_METRICS.includes(item.metric) ? "operations" : "participation") as SegmentKind, item.value],
    [`${item.metric}:correction`, "correction" as SegmentKind, item.correction]] as [string, SegmentKind, number][])
    : p.operations === undefined ? [["operations", "operations", p.change]]
      : [["operations", "operations", p.operations], ["participation", "participation", p.participation ?? 0], ["correction", "correction", p.correction ?? 0]];
  let up = 0, down = 0;
  const segments: Segment[] = [];
  for (const [key, kind, v] of parts.filter(([, , v]) => Math.abs(v) > 1e-9).sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]))) {
    const from = v > 0 ? up : down, to = from + v;
    if (v > 0) up = to; else down = to;
    // 같은 종류·같은 방향으로 이어지는 조각은 한 막대로 합친다(이음선이 생기지 않게).
    const same = segments.findLast((s) => s.kind === kind && s.to === from);
    if (same) { same.to = to; same.key += `+${key}`; } else segments.push({ key, kind, from, to });
  }
  return segments;
}

export function trendGeometry(points: readonly ChartPoint[], width: number, zoom: boolean) {
  const { left, right, top, line, gap, bars, axis } = TREND_BOX;
  const n = Math.max(1, points.length), step = Math.max(1, (width - left - right) / n);
  const x = (i: number) => left + step * (i + 0.5);
  const totals = points.map((p) => p.total);
  let low = Math.min(0, ...totals), high = Math.max(1, ...totals);
  // 12개월 보기는 누적 선이 평평해 보이지 않게 기간 안의 범위만 쓴다. 눈금 숫자로 시작값을 밝힌다.
  if (zoom && totals.length && Math.min(...totals) >= 0) {
    const min = Math.min(...totals), max = Math.max(...totals), pad = Math.max((max - min) * 0.15, 1);
    low = Math.max(0, min - pad); high = max + pad;
  }
  // 눈금 숫자가 실제 축 끝과 같도록 넓은 범위는 정수로 바깥쪽에 맞춘다(반올림하면 "50"과 "50"처럼 같은 값이 둘 선다).
  if (high - low >= 10) { low = Math.floor(low); high = Math.ceil(high); }
  const lineY = (v: number) => top + (high - v) / (high - low) * line;
  const stacks = points.map(stackSegments);
  const up = Math.max(0, ...stacks.flat().map((s) => Math.max(s.from, s.to)));
  const down = Math.min(0, ...stacks.flat().map((s) => Math.min(s.from, s.to)));
  const barTop = top + line + gap, barHigh = up || (down ? 0 : 1);
  const barY = (v: number) => barTop + (barHigh - v) / (barHigh - down) * bars;
  return { step, x, lineY, lineTicks: [low, high], barY, barTicks: [...(up > 0 ? [up] : []), 0, ...(down < 0 ? [down] : [])],
    stacks, barWidth: Math.max(2, Math.min(30, step * 0.62)), barTop, axisY: barTop + bars + axis - 8, height: TREND_HEIGHT };
}

/** 달력 경계(1·4·7·10월, 1·7월, 1월)에 맞춰 고르고 첫 칸·마지막 칸은 자리가 있을 때만 더한다. 해가 바뀌는 칸은 연도를 적는다. */
export function monthTicks(points: readonly ChartPoint[], step: number) {
  const gap = 56, every = [1, 2, 3, 6, 12, 24, 36, 60].find((k) => k * step >= gap) ?? 120;
  const serial = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const picks = points.flatMap((p, i) => serial(p.month) % every ? [] : [i]), last = points.length - 1;
  if (last >= 0 && !picks.includes(last) && (!picks.length || (last - picks.at(-1)!) * step >= gap)) picks.push(last);
  if (last >= 0 && !picks.includes(0) && (!picks.length || picks[0]! * step >= gap)) picks.unshift(0);
  let lastYear = "";
  return picks.map((i) => {
    const year = points[i]!.month.slice(0, 4), month = Number(points[i]!.month.slice(5));
    const text = year === lastYear ? `${month}월` : every >= 12 && month === 1 ? year : `${year}.${month}`;
    lastYear = year;
    return { index: i, text };
  });
}

/** 가장 가까운 칸. 좁은 차트에서 칸이 몇 px뿐이어도 포인터 위치로 판정한다. */
export function nearestIndex(position: number, width: number, count: number) {
  const step = Math.max(1, (width - TREND_BOX.left - TREND_BOX.right) / Math.max(1, count));
  return Math.max(0, Math.min(count - 1, Math.floor((position - TREND_BOX.left) / step)));
}
