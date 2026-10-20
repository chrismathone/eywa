import { axisLabel, summarize, type Point, type TrendRange } from "@/features/students/stats/model";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/** 첫 선(학원 전체 · 과목 관리자는 담당 과목 전체) 요약 — 기간 첫 칸 대비 증감 · 가장 많았던 때 · 가장 적었던 때. */
export function TrendFacts({ points, range, who }: { points: readonly Point[]; range: TrendRange; who: string }) {
  const sum = summarize(points);
  const first = sum.first ? axisLabel(sum.first, range) : "";
  return (
    <dl className="grid grid-cols-1 gap-2 @xl/panel:grid-cols-3">
      <Fact
        label={`${who} · ${first} 대비`}
        value={sum.change === null ? "—" : `${sum.change > 0 ? "+" : ""}${fmt(sum.change)}명`}
        sub={sum.changeRate === null ? undefined : `${sum.changeRate > 0 ? "+" : ""}${sum.changeRate}%`}
        tone={sum.change === null || sum.change === 0 ? undefined : sum.change > 0 ? "up" : "down"}
      />
      <Fact label={`${who} · 가장 많았던 때`} value={sum.peak ? `${fmt(sum.peak.count)}명` : "—"} sub={sum.peak ? axisLabel(sum.peak, range) : undefined} />
      <Fact label={`${who} · 가장 적었던 때`} value={sum.low ? `${fmt(sum.low.count)}명` : "—"} sub={sum.low ? axisLabel(sum.low, range) : undefined} />
    </dl>
  );
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-bg-soft/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`num text-lg font-bold ${tone === "up" ? "text-green" : tone === "down" ? "text-danger" : "text-foreground"}`}>
        {value}
        {sub ? <span className="text-muted-foreground ml-1.5 text-xs font-medium">{sub}</span> : null}
      </dd>
    </div>
  );
}
