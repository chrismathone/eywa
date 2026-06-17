/**
 * ④ 슬림 7일 추세 — 출석·수납 sparkline 2개 + 값/변화량. (구 trend-card 풀차트 대체,
 * 미사용이던 sparkline.tsx 재사용.)
 */
import { Sparkline } from "./sparkline";
import { trendDelta } from "@/features/dashboard/metrics";
import type { TrendPoint } from "@/features/dashboard/server/queries";

export function SlimTrend({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return null;
  const attendance = data.map((p) => p.attendance);
  const payment = data.map((p) => p.payment);
  const range = `${data[0].date} – ${data[data.length - 1].date}`;

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-foreground text-[15px] font-bold">최근 7일 추세</h2>
        <span className="text-text-faint font-mono text-[10px]">{range}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <TrendRow label="출석률" values={attendance} colorVar="--color-chart-2" />
        <TrendRow label="수납률" values={payment} colorVar="--color-chart-3" />
      </div>
    </section>
  );
}

function TrendRow({
  label,
  values,
  colorVar,
}: {
  label: string;
  values: number[];
  colorVar: string;
}) {
  // 창에 실데이터가 없으면(전부 0) 가짜 "0% 평탄선" 대신 정직하게 '기록 없음'.
  // (밴드의 최근 스냅샷과 모순되어 보이던 0% 문제 해소 — 추세는 0%라고 단정하지 않는다.)
  const hasData = values.some((v) => v > 0);
  const last = values[values.length - 1] ?? 0;
  const delta = trendDelta(values);
  const deltaText = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`;
  return (
    <div className="border-line flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <div className="w-[52px] shrink-0">
        <div
          className="font-mono text-[10px] tracking-wider uppercase"
          style={{ color: `var(${colorVar})` }}
        >
          {label}
        </div>
        {hasData ? (
          <div className="num text-foreground text-[18px] font-extrabold leading-none">
            {Math.round(last)}
            <span className="text-text-dim text-[11px] font-medium">%</span>
          </div>
        ) : (
          <div className="text-text-faint text-[11px] leading-none">기록 없음</div>
        )}
      </div>
      {hasData ? (
        <>
          <div className="h-9 flex-1">
            <Sparkline data={values} colorVar={colorVar} height={36} strokeWidth={2} />
          </div>
          <span
            className={`shrink-0 font-mono text-[10px] ${delta >= 0 ? "text-primary" : "text-danger"}`}
          >
            {deltaText}
          </span>
        </>
      ) : (
        <div className="text-text-faint flex h-9 flex-1 items-center text-[11px]">
          최근 7일 데이터가 아직 없습니다
        </div>
      )}
    </div>
  );
}
