import { summarize, type LabelRange, type Point } from "@/features/students/stats/model";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/** 첫 선(학원 전체 · 과목 관리자는 담당 과목 전체) 요약 — 기간 첫 칸 대비 증감 · 가장 많았던 때 · 가장 적었던 때. `unit` = 명(재원생) · 개(강좌수). */
/** 요약 상자의 때 — 줄인 축 글자('26.04') 대신 읽히는 말로('2026년 4월' · '9/28 주' · '2026년'). */
const when = (p: Point, range: LabelRange) =>
  range === "d"
    ? `${Number(p.key.slice(5, 7))}월 ${Number(p.key.slice(8, 10))}일`
    : range === "w26"
      ? `${p.label} 주`
      : range === "y"
        ? `${p.key}년`
        : `${p.key.slice(0, 4)}년 ${Number(p.key.slice(5, 7))}월`;

export function TrendFacts({ points, range, who, unit = "명" }: { points: readonly Point[]; range: LabelRange; who: string; unit?: string }) {
  const sum = summarize(points);
  const first = sum.first ? when(sum.first, range) : "";
  return (
    <dl className="grid grid-cols-1 gap-2 @xl/panel:grid-cols-3">
      <Fact
        label={`${who} · ${first} 대비`}
        value={sum.change === null ? "—" : `${sum.change > 0 ? "+" : ""}${fmt(sum.change)}${unit}`}
        sub={sum.changeRate === null ? undefined : `${sum.changeRate > 0 ? "+" : ""}${sum.changeRate}%`}
        tone={sum.change === null || sum.change === 0 ? undefined : sum.change > 0 ? "up" : "down"}
      />
      <Fact label={`${who} · 가장 많았던 때`} value={sum.peak ? `${fmt(sum.peak.count)}${unit}` : "—"} sub={sum.peak ? when(sum.peak, range) : undefined} />
      <Fact label={`${who} · 가장 적었던 때`} value={sum.low ? `${fmt(sum.low.count)}${unit}` : "—"} sub={sum.low ? when(sum.low, range) : undefined} />
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
