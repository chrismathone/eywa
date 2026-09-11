import type { DailyChart } from "../sheet-model";
import { EmptyNote } from "./jj-sheet-parts";

/**
 * 일별 학습량 — 기둥(푼 문제 수, 한 색) + 학습한 날 평균 점선 + 최고치 이름표 하나. 순수 CSS(차트 라이브러리 없음).
 * 날짜 이름표는 기둥 가운데에 맞춰 띄엄띄엄(모델이 고른 날만). 그리기 전용 — 숫자는 sheet-model.ts.
 */
export function JjDailyChart({ chart, tall = false }: { chart: DailyChart; tall?: boolean }) {
  if (!chart.peak) return <EmptyNote>기간 중 학습 기록이 없습니다.</EmptyNote>;
  const n = chart.bars.length;
  // 기간이 길면(최대 1년) 기둥 사이 틈을 줄이거나 없앤다 — 틈만으로 폭을 다 써서 기둥이 0px이 되거나 틀을 넘어
  // 날짜 이름표와 어긋난다(적대 리뷰 2026-09-11).
  const gap = n > 60 ? "" : n > 31 ? "gap-px" : "gap-0.5";
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`일별 푼 문제 수 · ${chart.note}`}>
      <div className={`${tall ? "h-44" : "h-32"} pt-6`}>
        <div className="border-line-strong relative h-full border-b">
          <div className={`absolute inset-0 flex items-end ${gap}`}>
            {chart.bars.map((b) => (
              <div key={b.key} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                {b.value > 0 ? (
                  <div className="bg-primary w-full max-w-5 rounded-t-sm" style={{ height: `${Math.max(3, b.pct)}%` }} />
                ) : null}
                {b.peak ? (
                  <span
                    className="num text-foreground absolute left-1/2 mb-0.5 -translate-x-1/2 text-xs font-bold whitespace-nowrap"
                    style={{ bottom: `${b.pct}%` }}
                  >
                    {b.value.toLocaleString("ko-KR")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {chart.avgPct != null && chart.avg != null ? (
            <div
              className="border-foreground/70 pointer-events-none absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${chart.avgPct}%` }}
            >
              <span className="bg-card num text-foreground absolute right-0 bottom-full mb-0.5 px-1 text-xs font-bold whitespace-nowrap">
                평균 {chart.avg.toLocaleString("ko-KR")}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="relative h-5" aria-hidden>
        {chart.bars.map((b, i) =>
          b.label ? (
            <span
              key={b.key}
              className="num text-text-dim absolute -translate-x-1/2 text-xs whitespace-nowrap"
              style={{ left: `${((i + 0.5) / n) * 100}%` }}
            >
              {b.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
