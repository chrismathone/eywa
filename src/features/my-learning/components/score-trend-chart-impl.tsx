"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PillColor } from "@/components/atoms/pill";
import { subjectColorOfRow } from "@/features/owner/subjects";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { pctOf, type Session } from "../history";

// 과목 색(학원설정 colorOf) → 차트 색. globals.css 토큰만 사용(리터럴 hex 금지 — primary만 v3 네이비로 갱신되고
// rose/gold/neutral은 v1 값에 멈춰 마디아 정합 토큰과 어긋나 있었다, 2026-07-20 감사).
const TONE_HEX: Record<PillColor, string> = {
  primary: "var(--color-primary)",
  green: "var(--color-green)",
  blue: "var(--color-blue)",
  rose: "var(--color-rose)",
  purple: "var(--color-purple)",
  gold: "var(--color-gold)",
  amber: "var(--color-amber)",
  danger: "var(--color-danger)",
  neutral: "var(--color-neutral-fill)",
};
const FAINT = "var(--color-neutral-fill)";

/** 테스트 점수 추이 — 확인(주선) + 일일(보조). 과목 필터로 시리즈 전환. */
export function ScoreTrendChart({ history, subjects }: { history: Session[]; subjects: string[] }) {
  const [filt, setFilt] = useState<string>("all");
  const subjectMaps = useSubjectMaps(); // 과목 색 = 학원설정(운영 enum 하드코딩 금지)
  const active = subjects.includes(filt) ? filt : "all";
  const primaryHex = active === "all" ? TONE_HEX.primary : TONE_HEX[subjectColorOfRow(subjectMaps, { name: active })];

  const valOf = (h: Session, kind: "daily" | "check") => {
    if (active === "all") return h[kind];
    return h.subjects.find((x) => x.name === active)?.[kind] ?? h[kind];
  };
  const data = history.map((h) => ({
    date: h.date,
    check: pctOf(valOf(h, "check")),
    daily: pctOf(valOf(h, "daily")),
  }));

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground text-base font-bold">테스트 점수 추이</h2>
        <div className="flex items-center gap-2.5 text-xs">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: primaryHex }} />
            확인
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: FAINT }} />
            일일
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <FilterBtn label="전체" on={active === "all"} onClick={() => setFilt("all")} />
        {subjects.map((s) => (
          <FilterBtn key={s} label={s} on={active === s} onClick={() => setFilt(s)} />
        ))}
      </div>

      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 4" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip
              formatter={(value, name) => [`${value}%`, name === "check" ? "확인테스트" : "일일테스트"]}
            />
            <Line
              type="monotone"
              dataKey="daily"
              stroke={FAINT}
              strokeWidth={2}
              strokeDasharray="2 5"
              dot={{ r: 2.5 }}
            />
            <Line
              type="monotone"
              dataKey="check"
              stroke={primaryHex}
              strokeWidth={3}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function FilterBtn({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-pill px-2.5 py-1 text-xs font-bold transition ${
        on ? "bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft border"
      }`}
    >
      {label}
    </button>
  );
}
