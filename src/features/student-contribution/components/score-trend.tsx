"use client";
import { useEffect, useRef, useState } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import { useSearchParams } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { useOntologyNavigation } from "./ontology-navigation";
import { numberText, monthText } from "./presentation";
export type TrendPoint = { month: string; total: number; change: number; corrected?: boolean; hasRecord?: boolean };

/** 점수 상한 대신 실제 누적값의 추이를 보여 준다. 음수 정정도 같은 축에 보존한다. */
export function ScoreTrend({ points, studentId, selectedMonth }: { points: TrendPoint[]; studentId: string; selectedMonth: string }) {
  const [range, setRange] = useState<"12" | "all">("all"), [focused, setFocused] = useState<string | null>(null);
  const [previewMonth, setPreviewMonth] = useState<string | null>(null);
  const params = useSearchParams(), embed = useEmbed(), { pending, navigate } = useOntologyNavigation();
  const graph = useRef<SVGSVGElement>(null), [width, setWidth] = useState(640);
  useEffect(() => {
    const node = graph.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const shown = range === "12" ? points.slice(-12) : points;
  const selectable = shown.filter((p) => p.hasRecord !== false);
  const active = selectable.find((p) => p.month === selectedMonth) ?? selectable.at(-1);
  const chosen = shown.find((p) => p.month === previewMonth) ?? active;
  const focusMonth = selectable.find((p) => p.month === focused)?.month ?? active?.month;
  if (!chosen) return null;
  const href = (month: string) => {
    const query = new URLSearchParams(params.toString()); query.set("month", month); query.delete("page");
    const path = `/student-contribution/${encodeURIComponent(studentId)}?${query}`;
    return embed ? withEmbed(path) : path;
  };
  const selectMonth = (month: string) => {
    if (shown.find((p) => p.month === month)?.hasRecord === false) { setPreviewMonth(month); return; }
    graph.current?.querySelector<SVGElement>(`[data-month="${month}"]`)?.focus({ preventScroll: true });
    setFocused(month);
    if (!pending && month !== selectedMonth) navigate(href(month)); setPreviewMonth(null);
  };
  const height = 220, left = 65, right = 20, top = 18, bottom = 35;
  const min = Math.min(0, ...shown.map((p) => p.total)), max = Math.max(1, ...shown.map((p) => p.total));
  const x = (index: number) => left + index * (width - left - right) / Math.max(1, shown.length - 1);
  // Adjacent hit circles overlap on long/mobile charts. Use the pointer's nearest month, not SVG paint order.
  const pointerMonth = (clientX: number, fallback: string) => {
    const bounds = graph.current?.getBoundingClientRect();
    if (!bounds?.width) return fallback;
    const position = (clientX - bounds.left) * width / bounds.width;
    const index = Math.round((position - left) / (width - left - right) * (shown.length - 1));
    return shown[Math.max(0, Math.min(shown.length - 1, index))]!.month;
  };
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const path = shown.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.total)}`).join(" ");
  const axis = [min, (min + max) / 2, max];
  return <section className="min-w-0 rounded-xl border border-line bg-card p-5" aria-label="누적 기여도 추이">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">현재 배점 기준 누적 추이</h3><p className="mt-1 text-xs">월별 실적을 현재 배점으로 다시 계산한 점수</p></div>
      <div className="flex rounded-lg border border-line p-1">{([['12', '최근 12개월'], ['all', '전체 기간']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={range === value}
        onClick={() => { setRange(value); setFocused(null); setPreviewMonth(null); }} className={`rounded-md px-2 py-1 text-xs focus-visible:outline-primary ${range === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>)}</div></div>
    <p className="mt-3 text-xs">표 기준: {monthText(selectedMonth)} · 점을 누르면 월별 내역도 바뀝니다.</p>
    <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1"><span className="text-sm">{monthText(chosen.month)}{chosen.month !== selectedMonth ? " 미리보기" : " 선택됨"}</span>
      <strong className="text-lg tabular-nums">{numberText(chosen.total)}점</strong><span className="text-xs">이 달 {chosen.change > 0 ? "+" : ""}{numberText(chosen.change)}점{chosen.corrected ? " · 정정 반영" : ""}</span>
      {chosen.hasRecord === false ? <span className="ml-auto text-xs">이 달 집계 기록 없음</span> : <Link href={href(chosen.month)} scroll={false} className="ml-auto text-xs text-primary underline underline-offset-4">이 달 내역</Link>}</div>
    {pending && <p role="status" className="mt-2 text-xs">선택한 월 내역을 불러오는 중…</p>}
    <svg ref={graph} viewBox={`0 0 ${width} ${height}`} className="mt-2 h-56 w-full overflow-visible" onMouseLeave={() => setPreviewMonth(null)} onMouseMove={(event) => setPreviewMonth(pointerMonth(event.clientX, chosen.month))} aria-label="월별 누적 기여도. 방향키로 월을 살펴보고 Enter 키로 선택하세요.">
      {axis.map((value) => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--line)" strokeDasharray="3 4" />
        <text x={left - 10} y={y(value) + 5} textAnchor="end" fill="currentColor" className="text-xs">{numberText(Math.round(value))}</text></g>)}
      <path d={`${path} L${x(shown.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill="var(--primary-softer)" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" />
      {shown.map((p, i) => <g key={p.month}><circle cx={x(i)} cy={y(p.total)} r={p.month === chosen.month ? 5 : p.corrected ? 4 : 2.5} fill={p.corrected ? "var(--amber)" : "var(--primary)"} />
        <circle data-month={p.month} cx={x(i)} cy={y(p.total)} r={10} fill="transparent" tabIndex={p.month === focusMonth ? 0 : -1} role="button" aria-pressed={p.month === selectedMonth} aria-disabled={pending || p.hasRecord === false} aria-label={`${monthText(p.month)} 누적 ${numberText(p.total)}점${p.hasRecord === false ? " · 집계 기록 없음" : ""}`}
          onFocus={() => { setFocused(p.month); setPreviewMonth(p.month); }} onBlur={() => setPreviewMonth(null)} onMouseEnter={() => setPreviewMonth(p.month)} onClick={(event) => selectMonth(event.detail === 0 ? p.month : pointerMonth(event.clientX, p.month))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMonth(p.month); }
            const index = selectable.findIndex((point) => point.month === p.month);
            const next = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : e.key === "Home" ? 0 : e.key === "End" ? selectable.length - 1 : null;
            if (next !== null && selectable.length) { e.preventDefault(); graph.current?.querySelector<SVGElement>(`[data-month="${selectable[Math.max(0, Math.min(selectable.length - 1, next))]!.month}"]`)?.focus(); }
          }} className="cursor-pointer focus-visible:stroke-primary" />
        {(i === 0 || i === shown.length - 1 || (shown.length > 4 && i === Math.floor(shown.length / 2))) && <text x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === shown.length - 1 ? "end" : "middle"} className="text-xs" fill="currentColor">{p.month}</text>}
      </g>)}
    </svg>
    <p className="text-xs leading-relaxed">노란색 점은 정정이 반영된 달입니다. 배점을 바꾸면 전체 기간의 점수가 달라지며, 환불 등 정정으로 누적 점수가 내려갈 수 있습니다.</p>
  </section>;
}
