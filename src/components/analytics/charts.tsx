"use client";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import { chartNumber, chartScale, composition, palette, type ChartDatum } from "./chart-math";
import s from "./analytics.module.css";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";

/** 숫자 카드 머리 아이콘 — 손그림 SVG 대신 공용 아이콘(P0-3b 리뷰). */
const STAT_ICON: Record<"chart" | "people" | "record" | "money", AywaIconName> = { chart: "chart", people: "users", record: "report", money: "wallet" };

export function StatCard({ label, value, unit, note, accent = palette[0], href, icon = "chart" }: { label: string; value: number | null; unit: string; note?: string; accent?: string; href?: string; icon?: "chart" | "people" | "record" | "money" }) {
  return <article className={s.stat} style={{ "--stat-accent": accent } as CSSProperties}><div className={s.statTop}><span className={s.statLabel}>{href ? <Link href={href}>{label} ↗</Link> : label}</span><span className={s.statIcon}><EyIcon name={STAT_ICON[icon]} size={17} /></span></div><div className={s.statValue}>{value === null ? "—" : chartNumber(value, unit)}<span className={s.statUnit}>{value === null ? "확인 필요" : unit}</span></div><div className={s.statFoot}>{note ?? "현재 확인된 자료 기준"}</div></article>;
}
export function ChartCard({ title, kicker, tag, note, href, wide, children }: { title: string; kicker?: string; tag?: string; note?: string; href?: string; wide?: boolean; children: ReactNode }) {
  return <article className={`${s.chartCard} ${wide ? s.wide : ""}`}><header className={s.chartHeader}><div>{kicker && <div className={s.chartKicker}>{kicker}</div>}<h3>{title}</h3></div>{tag && <span className={s.tag}>{tag}</span>}</header>{children}{note && <p className={s.chartNote}>{note}</p>}{href && <div className={s.chartFoot}><span>기록과 계산 근거</span><Link href={href}>자세히 보기 ↗</Link></div>}</article>;
}
export function DonutChart({ data, center, label, unit = "", showPercent = true, empty = "구성비를 표시할 자료가 없습니다." }: { data: ChartDatum[]; center?: string; label: string; unit?: string; showPercent?: boolean; empty?: string }) {
  const parts = composition(data);
  if (!parts) return <div className={s.empty}>{empty}{data.some(d => d.value < 0) && <span>음수 정정이 포함되어 비중 대신 원수치를 확인해 주세요.</span>}</div>;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const centerText = center ?? `${chartNumber(total, unit)}${unit}`;
  return <div className={s.donutLayout}><div className={s.donutPicture}><svg role="img" aria-label={`${label}: ${parts.map(p => `${p.label} ${p.percent.toFixed(1)}%`).join(", ")}`} viewBox="0 0 180 180"><circle cx="90" cy="90" r="70" fill="none" stroke="var(--av-ring-track)" strokeWidth="24"/>{parts.filter(p => p.value > 0).map(p => <circle key={p.label} cx="90" cy="90" r="70" fill="none" stroke={p.color} strokeWidth="24" pathLength="100" strokeDasharray={`${p.percent} ${100 - p.percent}`} strokeDashoffset={-p.start}><title>{`${p.label}: ${chartNumber(p.value, unit)}${unit} (${p.percent.toFixed(1)}%)`}</title></circle>)}</svg><div className={s.donutCenter}><strong style={centerText.length > 7 ? { fontSize: 18 } : undefined}>{centerText}</strong><span>{label}</span></div></div><ul className={s.donutLegend}>{parts.map(p => <li key={p.label}><i className={s.dot} style={{ background: p.color }}/><span className={s.legendName}>{p.label}</span><strong>{chartNumber(p.value, unit)}{unit}</strong>{showPercent && <small>{p.percent.toFixed(1)}%</small>}</li>)}</ul></div>;
}
export function RankBars({ data, unit = "건", empty = "표시할 기록이 없습니다." }: { data: ChartDatum[]; unit?: string; empty?: string }) {
  if (!data.length) return <div className={s.empty}>{empty}</div>;
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  return <div className={s.bars}>{data.map((d, i) => <div key={d.label} className={s.barRow} title={`${d.label} ${d.value.toLocaleString()}${unit}`}><span className={s.barLabel}>{d.label}</span><div className={s.barTrack}><div className={s.barFill} style={{ width: `${Math.abs(d.value) / max * 100}%`, minWidth: d.value === 0 ? 0 : undefined, "--stat-accent": d.color ?? palette[i % palette.length] } as CSSProperties}/></div><span className={s.barValue}>{chartNumber(d.value)}{unit}</span></div>)}</div>;
}

export type SeriesPoint = { label: string; values: (number | null)[]; partial?: boolean };
export function SeriesChart({ points, series, unit = "점", initialMode = "line" }: { points: SeriesPoint[]; series: { label: string; color: string }[]; unit?: string; initialMode?: "line" | "bar" }) {
  const uid = useId().replace(/:/g, ""), [mode, setMode] = useState(initialMode), [active, setActive] = useState<number | null>(null);
  const scale = chartScale(points.flatMap(p => p.values));
  if (!scale || !points.length) return <div className={s.empty}>선택한 기간의 자료가 없습니다.</div>;
  const width = 600, height = 232, left = 48, right = 16, top = 18, bottom = 33;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (i: number) => left + plotW / points.length * (i + .5);
  const y = (n: number) => top + (scale.max - n) / scale.range * plotH;
  const selected = points[active ?? points.length - 1];
  return <div className={s.chartWrap}>
    <div className={s.chartHeader} style={{ marginBottom: 7 }}><div className={s.legend}>{series.map(d => <span key={d.label}><i className={s.dot} style={{ background: d.color }}/>{d.label}</span>)}</div><div className={s.mode} aria-label="차트 표시 방식"><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>추이</button><button type="button" aria-pressed={mode === "bar"} onClick={() => setMode("bar")}>막대</button></div></div>
    <div className={s.hoverValue}><strong>{selected.label}{selected.partial ? " · 일부 자료 기준" : ""}</strong><span>{series.map((s, i) => `${s.label} ${selected.values[i] == null ? "미확인" : `${chartNumber(selected.values[i]!, unit)}${unit}`}`).join("  ·  ")}</span></div>
    <svg className={s.chartSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map(d => d.label).join("·")} ${mode === "line" ? "추이" : "비교"} 차트`} onMouseLeave={() => setActive(null)}>
      <defs>{series.map((d, i) => <linearGradient key={d.label} id={`${uid}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={d.color} stopOpacity=".14"/><stop offset="100%" stopColor={d.color} stopOpacity=".02"/></linearGradient>)}</defs>
      {active !== null && <rect x={x(active) - plotW / points.length / 2} y={top} width={plotW / points.length} height={plotH} fill="var(--av-hover)"/>}
      {[0, 1, 2, 3].map(i => { const value = scale.min + scale.range * i / 3; return <g key={i}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--av-grid-line)" strokeDasharray="3 5"/><text x={left - 9} y={y(value) + 3} textAnchor="end">{chartNumber(value, unit)}</text></g>; })}
      <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--av-axis-line)"/>
      {series.map((d, si) => {
        const segments: { x: number; y: number }[][] = []; let segment: { x: number; y: number }[] = [];
        points.forEach((p, i) => { const value = p.values[si]; if (value == null || !Number.isFinite(value)) { if (segment.length) segments.push(segment); segment = []; } else segment.push({ x: x(i), y: y(value) }); }); if (segment.length) segments.push(segment);
        const barWidth = Math.min(32, plotW / points.length / (series.length + 1));
        return <g key={d.label}>{mode === "line" && segments.map((seg, i) => { const path = seg.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" "); return <g key={i}><path d={`${path} L${seg.at(-1)!.x},${y(0)} L${seg[0].x},${y(0)} Z`} fill={`url(#${uid}-${si})`}/><path d={path} fill="none" stroke={d.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></g>; })}{points.map((p, i) => { const value = p.values[si]; if (value == null || !Number.isFinite(value)) return null; const title = `${p.label} ${d.label}: ${value.toLocaleString()}${unit}${p.partial ? " (일부 자료)" : ""}`; return mode === "bar" ? <rect key={p.label} x={x(i) + (si - series.length / 2) * barWidth} y={Math.min(y(value), y(0))} width={Math.max(1, barWidth - 4)} height={Math.abs(y(value) - y(0))} rx="4" fill={d.color} onMouseEnter={() => setActive(i)}><title>{title}</title></rect> : <circle key={p.label} cx={x(i)} cy={y(value)} r={active === i ? 5 : 3} fill="var(--card,#fff)" stroke={d.color} strokeWidth="2" onMouseEnter={() => setActive(i)}><title>{title}</title></circle>; })}</g>;
      })}
      {points.map((p, i) => <g key={p.label}><rect x={x(i) - plotW / points.length / 2} y={top} width={plotW / points.length} height={plotH} fill="transparent" onMouseEnter={() => setActive(i)}><title>{`${p.label}: ${p.values.map((v, j) => `${series[j]?.label} ${v == null ? "미확인" : `${v}${unit}`}`).join(", ")}`}</title></rect><text className={s.axisLabel} x={x(i)} y={height - 10} textAnchor="middle">{p.label}</text></g>)}
    </svg>
    <details className={s.dataTable}><summary>수치 표로 보기 · {unit} 기준</summary><table><thead><tr><th>기간</th>{series.map(d => <th key={d.label}>{d.label}</th>)}</tr></thead><tbody>{points.map(p => <tr key={p.label}><th>{p.label}{p.partial ? " *" : ""}</th>{series.map((d, i) => <td key={d.label}>{p.values[i] == null ? "미확인" : p.values[i]!.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>)}</tr>)}</tbody></table></details>
  </div>;
}
