import { dateConflict, type EventRow } from "./model";
import s from "./monthly-year-chart.module.css";

export const COMPARISON_YEARS = [2023, 2024, 2025, 2026] as const;
export function monthlyYearSeries(events: EventRow[]) {
  const series = COMPARISON_YEARS.map(year => ({ year, months: Array<number>(12).fill(0) }));
  for (const event of events) {
    if (dateConflict(event.document)) continue;
    const period = event.document.date ?? event.document.period;
    if (!period) continue;
    const row = series.find(row => row.year === Number(period.slice(0, 4)));
    if (row) row.months[Number(period.slice(5, 7)) - 1] += 1;
  }
  return series;
}

export function MonthlyYearChart({ events }: { events: EventRow[] }) {
  const series = monthlyYearSeries(events);
  const maximum = Math.max(1, ...series.flatMap(row => row.months));
  const step = Math.max(1, Math.ceil(maximum / 4)), ceiling = step * 4;
  const left = 34, top = 28, height = 168, width = 672, bottom = top + height, groupWidth = width / 12;
  return <div className={s.root}>
    <h2>연도별 월간 행사 기록</h2>
    <p className={s.caption}>{COMPARISON_YEARS.join("·")}년 비교 · 날짜 충돌 제외 · 월 단위 기록 포함</p>
    <div className={s.legend} aria-label="연도 범례">
      {series.map(row => <span key={row.year}><i style={{ background: `var(--year-${row.year})` }} />{row.year}년 <b>{row.months.reduce((sum, value) => sum + value, 0)}건</b></span>)}
    </div>
    <div className={s.scroll}>
      <svg className={s.chart} viewBox="0 0 720 233" role="img" aria-label={`${COMPARISON_YEARS.map(year => `${year}년`).join("·")} 월별 행사 기록 비교 막대그래프`}>
        <text x={left} y="13" className={s.axis}>건</text>
        {Array.from({ length: 5 }, (_, i) => {
          const n = i * step, y = bottom - n / ceiling * height;
          return <g key={n}><line x1={left} y1={y} x2={left + width} y2={y} className={s.grid} /><text x={left - 9} y={y + 4} textAnchor="end" className={s.axis}>{n}</text></g>;
        })}
        {Array.from({ length: 12 }, (_, month) => <g key={month}>
          {series.map((row, index) => {
            const n = row.months[month], barHeight = n / ceiling * height;
            const x = left + month * groupWidth + groupWidth / 2 - (series.length * 12 - 2) / 2 + index * 12;
            return <g key={row.year}>
              <rect x={x} y={bottom - barHeight} width="10" height={barHeight} rx="2" fill={`var(--year-${row.year})`}><title>{row.year}년 {month + 1}월: {n}건</title></rect>
              {n > 0 && <text x={x + 5} y={bottom - barHeight - 6} textAnchor="middle" className={s.value}>{n}</text>}
            </g>;
          })}
          <text x={left + month * groupWidth + groupWidth / 2} y={bottom + 22} textAnchor="middle" className={s.axis}>{month + 1}월</text>
        </g>)}
      </svg>
    </div>
    <p className={s.note}>0건은 수집된 기록이 없다는 뜻입니다. 개최 완료 행사 수와는 다릅니다.</p>
  </div>;
}
