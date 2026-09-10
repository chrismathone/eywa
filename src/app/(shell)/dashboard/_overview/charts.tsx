"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Distribution } from "@/features/dashboard/overview/model";
import { dashboardDate } from "@/features/dashboard/overview/display";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";

export const COLORS = [
  "#153e75",
  "#327fa8",
  "#0d7743",
  "#bc7f26",
  "#8666a5",
  "#84909e",
];
export const number = (n: number) => n.toLocaleString("ko-KR");
export const money = (n: number) => `${number(Math.round(n / 10_000))}만원`;
/** 차트 눈금과 막대 라벨용 축약 금액. 원 단위 원본은 툴팁과 수치 표에 유지한다. */
export function chartMoney(n: number) {
  const amount = Math.abs(n);
  const [scale, unit] =
    amount >= 100_000_000
      ? ([100_000_000, "억"] as const)
      : amount >= 10_000
        ? ([10_000, "만"] as const)
        : ([1, "원"] as const);
  return `${(n / scale).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}
type Datum = { label: string; value: number; color?: string };

function useChartWidth(initial: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function axisCeiling(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return Math.max(2, Math.ceil(value / magnitude) * magnitude);
}

export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div className={s.legend}>
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function Bars({
  data,
  unit = "명",
  color = COLORS[0],
  limit,
  title = "전체 분포",
}: {
  data: Datum[];
  unit?: string;
  color?: string;
  limit?: number;
  title?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const shown = limit ? data.slice(0, limit) : data;
  return (
    <>
      <div className={s.bars}>
        {shown.map((d) => (
          <div
            className={s.barRow}
            key={d.label}
            title={`${d.label} ${number(d.value)}${unit}`}
          >
            <span className={s.barLabel}>{d.label}</span>
            <span className={s.barTrack}>
              <i
                style={{
                  width: `${(d.value / max) * 100}%`,
                  background: d.color ?? color,
                }}
              />
            </span>
            <b>
              {number(d.value)}
              <small>{unit}</small>
            </b>
          </div>
        ))}
      </div>
      {limit && data.length > limit && (
        <DetailPopup title={title} label={`전체 ${data.length}개 보기`}>
          <Bars data={data} unit={unit} color={color} />
        </DetailPopup>
      )}
    </>
  );
}

export function Donut({
  data,
  label,
  unit = "명",
}: {
  data: Datum[];
  label: string;
  unit?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className={s.donutLayout}>
      <svg
        className={s.donut}
        viewBox="0 0 160 160"
        role="img"
        aria-label={`${label} ${number(total)}${unit}. ${data.map((d) => `${d.label} ${d.value}${unit}`).join(", ")}`}
      >
        <circle
          cx="80"
          cy="80"
          r="61"
          fill="none"
          stroke="#edf0f4"
          strokeWidth="20"
        />
        {data.map((d, i) => {
          if (d.value <= 0) return null;
          const length = (d.value / total) * 100;
          const start =
            (data.slice(0, i).reduce((sum, item) => sum + item.value, 0) /
              total) *
            100;
          return (
            <circle
              key={d.label}
              cx="80"
              cy="80"
              r="61"
              fill="none"
              stroke={d.color ?? COLORS[i % COLORS.length]}
              strokeWidth="20"
              pathLength="100"
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 80 80)"
            >
              <title>{`${d.label}: ${number(d.value)}${unit} (${length.toFixed(1)}%)`}</title>
            </circle>
          );
        })}
        <text x="80" y="77" textAnchor="middle" className={s.donutValue}>
          {number(total)}
        </text>
        <text x="80" y="101" textAnchor="middle" className={s.svgLabel}>
          {label}
        </text>
      </svg>
      <div className={s.donutLegend}>
        {data.map((d, i) => (
          <div key={d.label}>
            <span>
              <i style={{ background: d.color ?? COLORS[i % COLORS.length] }} />
              {d.label}
            </span>
            <b>
              {number(d.value)}
              <small>{unit}</small>
            </b>
            <em>{total ? `${Math.round((d.value / total) * 100)}%` : "—"}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Columns({
  labels,
  series,
  unit = "명",
  format = number,
  valueLabels = "all",
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  unit?: string;
  format?: (n: number) => string;
  valueLabels?: "all" | "last";
}) {
  const id = useId();
  const { ref, width } = useChartWidth(480);
  const max = axisCeiling(Math.max(1, ...series.flatMap((v) => v.values)));
  const rawMin = Math.min(0, ...series.flatMap((v) => v.values));
  const min = rawMin < 0 ? -axisCeiling(-rawMin) : 0;
  const height = 170,
    left = 45,
    right = 8,
    top = 26,
    bottom = 29;
  const plot = height - top - bottom;
  const y = (value: number) => top + ((max - value) / (max - min)) * plot;
  const group = (width - left - right) / Math.max(1, labels.length);
  const bar = Math.min(27, (group * 0.64) / series.length);
  return (
    <>
      <svg
        ref={ref}
        className={s.plot}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={id}
      >
        <title
          id={id}
        >{`${series.map((v) => v.name).join("·")} 비교 (${unit})`}</title>
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={width - right}
              y1={y(v)}
              y2={y(v)}
              stroke="#e2e7ed"
              strokeDasharray={v ? "3 4" : undefined}
            />
            <text x={left - 8} y={y(v) + 4} textAnchor="end" className={s.axis}>
              {format(v)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <g key={label}>
            {series.map((v, j) => {
              const value = v.values[i] ?? 0;
              const h = Math.abs(y(value) - y(0));
              const x =
                left + group * (i + 0.5) + (j - series.length / 2) * (bar + 3);
              return (
                <g key={v.name}>
                  <rect
                    x={x}
                    y={Math.min(y(value), y(0))}
                    width={bar}
                    height={h}
                    rx="2"
                    fill={v.color}
                  >
                    <title>{`${label} ${v.name}: ${number(value)}${unit}`}</title>
                  </rect>
                  {(valueLabels === "all" || j === series.length - 1) && (
                    <text
                      x={x + bar / 2}
                      y={y(value) + (value < 0 ? 13 : -5)}
                      textAnchor="middle"
                      className={s.columnValue}
                    >
                      {format(value)}
                    </text>
                  )}
                </g>
              );
            })}
            <text
              x={left + group * (i + 0.5)}
              y={height - 7}
              textAnchor="middle"
              className={s.axis}
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
      <Legend items={series.map((v) => ({ label: v.name, color: v.color }))} />
      <DetailPopup
        title={`${series.map((v) => v.name).join("·")} 수치`}
        label="차트 수치 보기"
        align="end"
      >
        <div className={s.dataTable}>
          <table>
            <thead>
              <tr>
                <th>기간</th>
                {series.map((v) => (
                  <th key={v.name}>
                    {v.name} ({unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={label}>
                  <th>{label}</th>
                  {series.map((v) => (
                    <td key={v.name}>{number(v.values[i] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailPopup>
    </>
  );
}

export function AttendanceHistory({
  points,
}: {
  points: { date: string; rate: number | null; total: number }[];
}) {
  const { ref, width } = useChartWidth(600);
  const height = 174,
    left = 38,
    top = 18,
    plotHeight = 120;
  const step = (width - left - 12) / Math.max(1, points.length);
  const bar = Math.min(26, step * 0.6);
  const x = (i: number) => left + step * (i + 0.5);
  const y = (n: number) => top + ((100 - n) / 100) * plotHeight;
  const heat = [
    "#b94141",
    "#bd553c",
    "#b96a34",
    "#a77c30",
    "#938b32",
    "#809539",
    "#639642",
    "#448b47",
    "#298146",
    "#177748",
    "#0d7743",
  ];
  return (
    <>
      <svg
        ref={ref}
        className={s.plot}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="최근 14일 등원율. 출석과 지각을 합한 출결 칸의 비율. 기록 없는 날은 비워 둡니다."
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={width - 12}
              y1={y(v)}
              y2={y(v)}
              stroke="#e2e7ed"
              strokeDasharray="3 4"
            />
            <text x={left - 7} y={y(v) + 4} textAnchor="end" className={s.axis}>
              {v}%
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.date}>
            {p.rate !== null && (
              <rect
                x={x(i) - bar / 2}
                y={y(p.rate)}
                width={bar}
                height={(plotHeight * p.rate) / 100}
                rx="2"
                fill={heat[Math.max(0, Math.min(10, Math.floor(p.rate / 10)))]}
              >
                <title>{`${dashboardDate(p.date)}: ${p.rate.toFixed(1)}% · ${p.total}칸`}</title>
              </rect>
            )}
            {p.rate === 0 && (
              <text
                x={x(i)}
                y={y(0) - 5}
                textAnchor="middle"
                className={s.axis}
              >
                0%
              </text>
            )}
            {(i === points.length - 1 ||
              (i % (width < 400 ? 3 : 2) === 0 &&
                points.length - 1 - i >= (width < 400 ? 3 : 2))) && (
              <text
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                className={s.axis}
              >
                {p.date.slice(5).replace("-", "/")}
              </text>
            )}
          </g>
        ))}
      </svg>
      <DetailPopup
        title="최근 14일 등원율"
        label="날짜별 수치 보기"
        align="end"
      >
        <div className={s.dataTable}>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>등원율</th>
                <th>출결 기록</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th>{dashboardDate(p.date)}</th>
                  <td>
                    {p.rate === null ? "기록 없음" : `${p.rate.toFixed(1)}%`}
                  </td>
                  <td>{number(p.total)}칸</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailPopup>
    </>
  );
}

export function Stack({
  data,
  label,
}: {
  data: (Distribution[number] & { color: string })[];
  label: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div
      className={s.stack}
      role="img"
      aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
    >
      {data
        .filter((d) => d.value > 0)
        .map((d) => (
          <span
            key={d.label}
            style={{
              width: `${(d.value / total) * 100}%`,
              background: d.color,
            }}
            title={`${d.label} ${d.value}`}
          />
        ))}
    </div>
  );
}
