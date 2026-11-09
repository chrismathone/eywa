"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { compareMonth } from "../model/score-trend";
import { useOntologyNavigation } from "./ontology-navigation";
import { monthText, numberText, signedText } from "./presentation";
import { monthTicks, nearestIndex, SEGMENT_FILL, trendGeometry, TREND_BOX, type ChartPoint } from "./trend-geometry";
import { TrendMonthPanel } from "./trend-month-panel";

const inRecent = (points: readonly ChartPoint[], month: string) => points.slice(-12).some((p) => p.month === month);
/** 눈금은 실제 축 끝 값 그대로(소수 둘째 자리까지) 적고 −0은 0으로. */
const axisText = (v: number) => numberText(Math.round(v * 100) / 100 + 0);

/** 위는 현재 배점으로 다시 계산한 누적, 아래는 그 달에 늘거나 준 점수. 음수 정정은 0 아래에 남긴다. */
export function ScoreTrend({ points, studentId, selectedMonth }: { points: ChartPoint[]; studentId: string; selectedMonth: string }) {
  const [range, setRange] = useState<"12" | "all">(() => points.length > 12 && inRecent(points, selectedMonth) ? "12" : "all");
  const [focused, setFocused] = useState<string | null>(null), [previewMonth, setPreviewMonth] = useState<string | null>(null);
  const [seenMonth, setSeenMonth] = useState(selectedMonth);
  // 근거 탭에서 오래된 달을 고르고 돌아와도 같은 달이 차트에 보이게 한다.
  if (seenMonth !== selectedMonth) { setSeenMonth(selectedMonth); if (!inRecent(points, selectedMonth)) setRange("all"); }
  const params = useSearchParams(), embed = useEmbed(), { pending, navigate } = useOntologyNavigation();
  const graph = useRef<SVGSVGElement>(null), [width, setWidth] = useState<number | null>(null);
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
  const pointerMonth = (clientX: number, fallback: string) => {
    const bounds = graph.current?.getBoundingClientRect();
    if (!bounds?.width) return fallback;
    return shown[nearestIndex((clientX - bounds.left) * measured / bounds.width, measured, shown.length)]!.month;
  };
  // 서버가 그린 첫 화면은 실제 폭을 모른다. 폭을 재기 전에는 자리만 잡아 두어 줄어든 차트가 튀어 보이지 않게 한다.
  const measured = width ?? 640, g = trendGeometry(shown, measured, range === "12"), last = shown.at(-1)!, before = points[points.length - shown.length - 1];
  const linePath = shown.map((p, i) => `${i ? "L" : "M"}${g.x(i)},${g.lineY(p.total)}`).join(" ");
  // 값 라벨은 칸이 글자 폭보다 넓을 때만 모든 막대에 쓴다. 좁으면 선택한 달 해설에서 읽는다.
  const labelAll = g.step >= Math.max(0, ...shown.map((p) => signedText(p.change).length)) * 9.5 + 12;
  return <section className="@container min-w-0 rounded-xl border border-line bg-card" aria-label="월별 기여와 누적 추이">
    <div className="grid @5xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">월별 기여와 누적 추이</h3>
          <p className="mt-1 text-xs leading-relaxed">모든 달을 현재 배점으로 다시 계산한 점수입니다. 그 달에 저장된 당시 점수가 아닙니다.</p></div>
          <div className={TOOLBAR_SEG_BOX}>{([["12", "12개월"], ["all", "전체 기간"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={range === value}
            onClick={() => { setRange(value); setFocused(null); setPreviewMonth(null); }} className={`${TOOLBAR_SEG_ITEM} ${range === value ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}>{label}</button>)}</div></div>
        <p className="mt-3 text-sm"><span className="tabular-nums">{monthText(shown[0]!.month)} ~ {monthText(last.month)}</span>
          <strong className="ml-2 tabular-nums">{signedText(last.total - (before?.total ?? 0))}점</strong>
          <span className="ml-2 text-xs tabular-nums">누적 {numberText(before?.total ?? 0)}점 → {numberText(last.total)}점</span></p>
        <svg ref={graph} viewBox={`0 0 ${measured} ${g.height}`} style={{ height: g.height, opacity: width === null ? 0 : 1 }} className="mt-3 w-full overflow-visible" role="group"
          onMouseLeave={() => setPreviewMonth(null)} onMouseMove={(event) => setPreviewMonth(pointerMonth(event.clientX, chosen.month))}
          aria-label="월별 기여와 누적 점수. 방향키로 달을 살펴보고 Enter 키로 선택하세요.">
          <defs><pattern id={`open-month-${studentId}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--card)" fillOpacity="0.55" /></pattern></defs>
          <text x={0} y={12} className="text-xs font-semibold" fill="currentColor">활동 누적 (점)</text>
          <line x1={0} x2={measured} y1={g.barTop - 54} y2={g.barTop - 54} stroke="var(--line)" />
          <text x={0} y={g.barTop - 30} className="text-xs font-semibold" fill="currentColor">월별 증감 (점)</text>
          {shown.map((p, i) => (p.month === chosen.month || p.month === selectedMonth) && <rect key={`band-${p.month}`} x={g.x(i) - g.step / 2} width={g.step} y={TREND_BOX.top - 6}
            height={g.axisY - TREND_BOX.top - 4} rx={4} fill={p.month === selectedMonth ? "var(--primary-soft)" : "var(--primary-softer)"} />)}
          {g.lineTicks.map((v) => <g key={`l${v}`}><line x1={TREND_BOX.left} x2={measured - TREND_BOX.right} y1={g.lineY(v)} y2={g.lineY(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={TREND_BOX.left - 8} y={g.lineY(v) + 5} textAnchor="end" className="text-xs" fill="currentColor">{axisText(v)}</text></g>)}
          {g.lineTicks[0] === 0 && <path d={`${linePath} L${g.x(shown.length - 1)},${g.lineY(0)} L${g.x(0)},${g.lineY(0)} Z`} fill="var(--primary-softer)" />}
          <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2.25} strokeLinejoin="round" />
          {g.barTicks.map((v) => <g key={`b${v}`}><line x1={TREND_BOX.left} x2={measured - TREND_BOX.right} y1={g.barY(v)} y2={g.barY(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} strokeDasharray={v === 0 ? undefined : "3 4"} />
            <text x={TREND_BOX.left - 8} y={g.barY(v) + 5} textAnchor="end" className="text-xs" fill="currentColor">{signedText(v)}</text></g>)}
          {shown.map((p, i) => { const open = p.status === "current" || p.status === "unclosed", w = g.barWidth, x0 = g.x(i) - w / 2;
            const merged = p.status === "merged", label = p.hasRecord !== false && !merged && labelAll, peak = Math.max(0, ...g.stacks[i]!.map((s) => s.to)), dip = Math.min(0, ...g.stacks[i]!.map((s) => s.to));
            return <g key={p.month}>
              {p.hasRecord === false ? <line x1={x0} x2={x0 + w} y1={g.barY(0)} y2={g.barY(0)} stroke="var(--text-placeholder)" strokeWidth={2} strokeDasharray="2 2" />
                : merged ? <line x1={x0} x2={x0 + w} y1={g.barY(0)} y2={g.barY(0)} stroke="var(--purple)" strokeWidth={2} strokeDasharray="4 2" />
                : !g.stacks[i]!.length ? <line x1={x0} x2={x0 + w} y1={g.barY(0)} y2={g.barY(0)} stroke="var(--primary)" strokeWidth={2} />
                : g.stacks[i]!.map((s) => <rect key={s.key} x={x0} width={w} y={g.barY(Math.max(s.from, s.to))} height={Math.max(1, Math.abs(g.barY(s.from) - g.barY(s.to)))} fill={SEGMENT_FILL[s.kind]} />)}
              {open && p.hasRecord !== false && <rect x={x0} width={w} y={g.barY(peak)} height={Math.max(1, g.barY(dip) - g.barY(peak))} fill={`url(#open-month-${studentId})`} stroke="var(--primary)" strokeDasharray="3 2" />}
              {label && <text x={g.x(i)} y={dip < 0 && peak === 0 ? g.barY(dip) + 16 : g.barY(peak) - 6} textAnchor="middle" className={`text-xs tabular-nums ${p.month === chosen.month ? "font-bold" : ""}`} fill="currentColor">{signedText(p.change)}</text>}
              <circle cx={g.x(i)} cy={g.lineY(p.total)} r={p.month === chosen.month ? 5 : open ? 3.5 : 0} fill={open ? "var(--card)" : "var(--primary)"} stroke="var(--primary)" strokeWidth={2} />
            </g>; })}
          {monthTicks(shown, g.step).map(({ index, text }) => <text key={index} x={g.x(index)} y={g.axisY} textAnchor="middle" fill="currentColor"
            className={`text-xs tabular-nums ${shown[index]!.month === selectedMonth ? "font-bold" : ""}`}>{text}</text>)}
          {shown.map((p, i) => <rect key={`hit-${p.month}`} data-month={p.month} x={g.x(i) - g.step / 2} width={g.step} y={0} height={g.axisY} fill="transparent"
            tabIndex={p.month === focusMonth ? 0 : -1} role="button" aria-pressed={p.month === selectedMonth} aria-disabled={pending || p.hasRecord === false}
            aria-label={`${monthText(p.month)} ${p.hasRecord === false ? "집계 기록 없음" : p.status === "merged" ? "병합 전 기록" : `그 달 ${signedText(p.change)}점`} · 누적 ${numberText(p.total)}점`}
            onFocus={() => { setFocused(p.month); setPreviewMonth(p.month); }} onBlur={() => setPreviewMonth(null)} onMouseEnter={() => setPreviewMonth(p.month)} onClick={(event) => selectMonth(event.detail === 0 ? p.month : pointerMonth(event.clientX, p.month))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMonth(p.month); }
              const index = selectable.findIndex((point) => point.month === p.month);
              const next = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : e.key === "Home" ? 0 : e.key === "End" ? selectable.length - 1 : null;
              if (next !== null && selectable.length) { e.preventDefault(); graph.current?.querySelector<SVGElement>(`[data-month="${selectable[Math.max(0, Math.min(selectable.length - 1, next))]!.month}"]`)?.focus(); }
            }} className="cursor-pointer outline-none focus-visible:stroke-primary focus-visible:stroke-2" />)}
        </svg>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="차트 범례">
          {([["operations", "운영 기여"], ["participation", "학습·참여"], ["correction", "정정(마감 뒤 바뀐 기록)"]] as const).map(([kind, label]) => <li key={kind} className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm" style={{ background: SEGMENT_FILL[kind] }} />{label}</li>)}
          <li className="flex items-center gap-1.5"><svg aria-hidden className="size-3 shrink-0" viewBox="0 0 12 12"><defs><pattern id={`legend-open-${studentId}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--card)" fillOpacity="0.55" /></pattern></defs>
            <circle cx="6" cy="6" r="5.5" fill="var(--primary)" /><circle cx="6" cy="6" r="5.5" fill={`url(#legend-open-${studentId})`} stroke="var(--primary)" strokeDasharray="3 2" /></svg>집계 중인 달</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-primary" />활동 누적</li>
          {shown.some((p) => p.hasRecord === false) && <li className="flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dotted border-text-placeholder" />집계 기록 없는 달</li>}
          {shown.some((p) => p.status === "merged") && <li className="flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed border-purple" />병합 전 기록</li>}
        </ul>
      </div>
      <TrendMonthPanel point={chosen} comparison={compareMonth(points, chosen.month)} preview={chosen.month !== selectedMonth} pending={pending} />
    </div>
  </section>;
}
