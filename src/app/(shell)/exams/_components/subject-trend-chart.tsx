import { SheetText } from "@/features/teacher-view/interface-label";

/**
 * 과목별 월별 평균 추이 — 과목마다 **색이 다른 선**(원장 2026-10-30 *"이 시험기록이 영어인지, 수학인지 과목표시가 되지 않고 있음 … 영어, 수학
 * 둘 모두 기입되었을때 색상구분해서 볼 수 있도록"*). 축·점 그리는 법은 `TrendChart`와 같다(세로축은 데이터 범위 · 선만 SVG · 점·라벨은 HTML).
 * 과목이 하나면 점 위에 값을 적고, 둘 이상이면 겹치지 않게 값은 마우스 오버(점 `title`)로만 — 대신 범례에 과목별 평균을 적는다.
 */
export type SubjectSeries = { key: string; label: string; color: string; average: number | null; count: number; points: { month: string; average: number }[] };

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

export function SubjectTrendChart({ series }: { series: SubjectSeries[] }) {
  const lines = series.filter((s) => s.points.length);
  if (!lines.length) return <p className="py-12 text-center text-sm"><SheetText value={"비교할 점수 기록이 없습니다."} /></p>;
  const months = [...new Set(lines.flatMap((s) => s.points.map((p) => p.month)))].sort();
  const [lo, hi] = domainOf(lines.flatMap((s) => s.points.map((p) => p.average)));
  const x = (month: string) => {
    const i = months.indexOf(month);
    return months.length === 1 ? 50 : 4 + (i * 92) / (months.length - 1);
  };
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const ticks = [hi, (hi + lo) / 2, lo];
  const single = lines.length === 1;
  return (
    <div>
      {/* 범례 — 과목 색 · 기록 수 · 평균(둘 이상이면 점 값 대신 여기서 읽는다). */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="과목별 범례">
        {lines.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="font-semibold">{s.label}</span>
            <span className="text-muted-foreground num">{s.count}건 · 평균 {s.average ?? "—"}{s.average == null ? "" : "%"}</span>
          </li>
        ))}
      </ul>
      <div
        className="mt-3 flex gap-2"
        role="img"
        aria-label={`과목별 월별 평균 정답률 ${lines.map((s) => `${s.label}: ${s.points.map((p) => `${p.month} ${p.average}%`).join(", ")}`).join(" / ")}`}
      >
        <div className="relative h-44 w-11 shrink-0 text-right text-xs" aria-hidden>
          {ticks.map((t) => <span key={t} className="num absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>{Math.round(t)}%</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-44">
            {ticks.map((t) => <div key={t} className="border-line-faint absolute inset-x-0 border-t border-dashed" style={{ top: `${y(t)}%` }} />)}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {lines.map((s) => (
                <path key={s.key} d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.month)} ${y(p.average)}`).join(" ")}
                  fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              ))}
            </svg>
            {lines.flatMap((s) => s.points.map((p) => (
              <div key={`${s.key}:${p.month}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(p.month)}%`, top: `${y(p.average)}%` }}
                title={`${s.label} ${Number(p.month.slice(5))}월 평균 ${p.average}%`}>
                {single ? <span className="num absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-xs font-bold whitespace-nowrap" style={{ color: s.color }}>{p.average}%</span> : null}
                <span className="bg-card block size-2.5 rounded-full border-2" style={{ borderColor: s.color }} />
              </div>
            )))}
          </div>
          <div className="relative mt-2 h-5 text-xs" aria-hidden>
            {months.map((m) => <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(m)}%` }}>{Number(m.slice(5))}<SheetText value={"월"} /></span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
