/**
 * 월별 평균 추이 — 세로축은 **데이터 범위에 맞춰** 잡는다(옛 0~100 고정은 평균 90점대가 한 줄로 눌려
 * "멈춘 것처럼" 보였다). 선만 SVG(비율 무시·선 굵기 고정)이고 점·값·월 라벨은 HTML로 같은 x%에 둔다
 * — SVG 안 원을 늘리면 타원이 되고, 라벨을 justify-between으로 두면 점과 어긋난다.
 */
type Point = { month: string; average: number };

function domainOf(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  let lo = Math.max(0, Math.floor((min - 5) / 5) * 5);
  let hi = Math.min(100, Math.ceil((max + 5) / 5) * 5);
  if (hi - lo < 20) {
    const pad = (20 - (hi - lo)) / 2;
    lo = Math.max(0, Math.floor((lo - pad) / 5) * 5);
    hi = Math.min(100, lo + 20);
  }
  return [lo, hi];
}

export function TrendChart({ points }: { points: Point[] }) {
  if (!points.length) return <p className="py-12 text-center text-sm">비교할 점수 기록이 없습니다.</p>;
  const [lo, hi] = domainOf(points.map((p) => p.average));
  const x = (i: number) => (points.length === 1 ? 50 : 4 + (i * 92) / (points.length - 1));
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const ticks = [hi, (hi + lo) / 2, lo];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.average)}`).join(" ");
  return <div className="mt-3 flex gap-2" role="img" aria-label={`월별 평균 ${points.map((p) => `${p.month} ${p.average}점`).join(", ")}`}>
    <div className="relative h-44 w-9 shrink-0 text-right text-xs" aria-hidden>
      {ticks.map((t) => <span key={t} className="num absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>{Math.round(t)}</span>)}
    </div>
    <div className="min-w-0 flex-1">
      <div className="relative h-44">
        {ticks.map((t) => <div key={t} className="border-line-faint absolute inset-x-0 border-t border-dashed" style={{ top: `${y(t)}%` }} />)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {points.map((p, i) => <div key={p.month} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(i)}%`, top: `${y(p.average)}%` }}>
          <span className="num text-primary absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-xs font-bold whitespace-nowrap">{p.average}</span>
          <span className="bg-card border-primary block size-2.5 rounded-full border-2" />
        </div>)}
      </div>
      <div className="relative mt-2 h-5 text-xs" aria-hidden>
        {points.map((p, i) => <span key={p.month} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(i)}%` }}>{Number(p.month.slice(5))}월</span>)}
      </div>
    </div>
  </div>;
}
