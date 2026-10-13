"use client";

import { useLayoutEffect, useRef } from "react";
import { Pill } from "@/components/atoms/pill";
import { metricOf, type Metric, type MetricId, type StoredPeriod } from "@/features/teacher-portfolio/model/types";
import {
  IMPACT_METRICS, MANAGEMENT_METRICS, METRIC_COLOR, METRIC_LABEL, SCORE_SCALE, closingLabel, fmtScore, scoreColor,
} from "@/features/teacher-portfolio/view";
import { Delta } from "./parts";

/**
 * 기간 평가 점수 — 총점 원 그래프와 8개 항목 막대.
 *
 * 달이나 강사를 바꾸면 게이지가 이전 값에서 새 값으로 움직인다(원장 2026-10-12). 이 컴포넌트는 그 사이
 * 다시 마운트되지 않으므로 폭·호 길이는 CSS 전환이 하고, 숫자만 아래 훅이 이어 센다.
 */
const MOTION = "duration-700 ease-out motion-reduce:transition-none";
const BULLET_STRIPES = "repeating-linear-gradient(135deg, var(--color-bg-soft) 0 4px, var(--color-card) 4px 8px)";

/** 값이 바뀌면 이전 숫자에서 새 숫자로 이어 센다. 움직임 줄이기 설정이면 바로 바꾼다. */
function useCountTo(value: number | null) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(value);
  // 레이아웃 단계에서 시작한다 — 새 숫자가 한 프레임 먼저 보였다가 되돌아가지 않게.
  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const el = ref.current;
    if (!el || value === null || from === null || from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    const at = (k: number) => (from + (value - from) * (1 - (1 - k) ** 3)).toFixed(1);
    el.textContent = at(0);
    let frame = requestAnimationFrame(function step(now: number) {
      const k = Math.min(1, (now - started) / 650);
      el.textContent = at(k);
      if (k < 1) frame = requestAnimationFrame(step);
    });
    // 글자는 건드리지 않는다 — 끊긴 뒤의 값은 React가 이미 써 두었다.
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return ref;
}

function ScoreRing({ total, onOpen }: { total: number | null; onOpen: () => void }) {
  const arc = total ?? 0;
  const number = useCountTo(total);
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <button type="button" onClick={onOpen} data-total={total ?? "unknown"}
        aria-label={total === null ? "합계 산출불가. 점수 근거 보기" : `잠정 점수 ${fmtScore(total)}점, 100점 만점. 점수 근거 보기`}
        className="focus-visible:outline-primary relative size-56 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
        <svg viewBox="0 0 240 240" aria-hidden fill="none" className="block size-full">
          <circle cx="120" cy="120" r="94" strokeWidth="34" className="stroke-bg-soft" />
          {/* 호 하나가 총점만큼만 이어진다. 0점·산출불가도 그려 두어야 달이 바뀔 때 양쪽으로 움직인다. */}
          <circle data-ring-arc cx="120" cy="120" r="94" strokeWidth="34" pathLength={100} transform="rotate(-90 120 120)"
            className={`transition-[stroke-dasharray,stroke] ${MOTION}`} style={{ strokeDasharray: `${arc} ${100 - arc}`, stroke: scoreColor(total) }} />
        </svg>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <small className="text-xs">{total === null ? "기간 평가 점수" : "잠정 점수"}</small>
          <strong className={`num mt-1 leading-none font-bold whitespace-nowrap ${total === null ? "text-xl" : "text-4xl"}`}>
            {total === null ? "산출불가" : <><span ref={number}>{fmtScore(total)}</span><em className="ml-1 text-sm not-italic">점</em></>}
          </strong>
          <small className="mt-2 text-xs">{total === null ? "일부 항목 확인 필요" : "100점 만점"}</small>
        </span>
      </button>
      <div className="w-full max-w-64">
        <div aria-hidden className="h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${scoreColor(0)}, ${scoreColor(50)}, ${scoreColor(100)})` }} />
        <div aria-hidden className="num mt-1.5 flex justify-between text-xs">
          {SCORE_SCALE.map((n) => <span key={n}>{n}{n === 100 ? "점" : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

function MetricRow({ metric, before, onOpen }: { metric: Metric; before: number | null | undefined; onOpen: (id: MetricId) => void }) {
  const number = useCountTo(metric.value);
  const pct = metric.value === null ? 0 : (metric.value / metric.max) * 100;
  const label = METRIC_LABEL[metric.id];
  return (
    <button type="button" onClick={() => onOpen(metric.id)} data-metric-row={metric.id}
      aria-label={`${label} ${fmtScore(metric.value)}${metric.value === null ? "" : "점"}, 근거 보기`}
      className="border-line-faint hover:bg-primary-softer focus-visible:outline-primary flex min-h-28 w-full flex-col justify-center border-b py-3.5 text-left last:border-b-0 focus-visible:outline-2">
      <span className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{label}</span>
        <b className={`num leading-none font-bold whitespace-nowrap ${metric.value === null ? "text-base" : "text-xl"}`}>
          <span ref={number}>{fmtScore(metric.value)}</span>
          <small className="ml-1 text-xs font-medium">/ {metric.max}점</small>
        </b>
      </span>
      <span className="bg-bg-soft relative block h-2 w-full rounded-full" style={metric.value === null ? { background: BULLET_STRIPES } : undefined}>
        <span data-bar className={`block h-full rounded-full transition-[width] ${MOTION}`} style={{ width: `${pct}%`, background: METRIC_COLOR[metric.id] }} />
        {/* 검은 눈금 = 전월 점수. 값은 아래 증감이 말한다. */}
        {before !== null && before !== undefined ? (
          <span aria-hidden className={`bg-foreground ring-card absolute -top-1 h-4 w-[3px] ring-1 transition-[left] ${MOTION}`}
            style={{ left: `${Math.min(100, (before / metric.max) * 100)}%` }} />
        ) : null}
      </span>
      <span className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="min-w-0">{metric.basis}</span>
        <Delta now={metric.value} before={before} />
      </span>
    </button>
  );
}

export function ScoreHero({ period, previous, onOpenMetric, onOpenLedger }: {
  period: StoredPeriod; previous: StoredPeriod | undefined; onOpenMetric: (id: MetricId) => void; onOpenLedger: () => void;
}) {
  const unavailable = period.items.filter((m) => m.value === null).map((m) => METRIC_LABEL[m.id]);
  const column = (title: string, ids: readonly MetricId[]) => (
    <section className="flex min-w-0 flex-col p-5">
      <h3 className="mb-1 text-base font-bold">{title} <span className="num text-xs font-medium">50점</span></h3>
      {ids.map((id) => <MetricRow key={id} metric={metricOf(period, id)} before={previous ? metricOf(previous, id).value : undefined} onOpen={onOpenMetric} />)}
    </section>
  );
  return (
    <div className="bg-card shadow-card grid min-w-0 grid-cols-1 overflow-hidden rounded-2xl lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.8fr)]">
      <section className="border-line flex min-w-0 flex-col gap-4 border-b p-5 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold">기간 평가 점수</h3>
          <Pill color={period.closing.closedAt ? "neutral" : "blue"}>{closingLabel(period)}</Pill>
        </div>
        <ScoreRing total={period.total} onOpen={onOpenLedger} />
        <dl className="grid gap-2 text-xs">
          {([["점수 산출", `${period.knownCount} / 8개 항목`], ["산출된 항목 합계", `${period.knownScore.toFixed(1)} / ${period.knownMax}점`], ["전체 배점", "100점"]] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><dt>{k}</dt><dd className="num font-bold whitespace-nowrap">{v}</dd></div>
          ))}
        </dl>
        <p className="border-line-faint mt-auto border-t pt-3 text-xs leading-relaxed">
          {unavailable.length ? `${unavailable.join(" · ")} 항목의 근거가 더 필요합니다.` : "8개 항목을 합산한 점수입니다."}
        </p>
      </section>
      <div className="divide-line-faint grid min-w-0 grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {column("수업·학생 관리", MANAGEMENT_METRICS)}
        {column("학원 운영 영향", IMPACT_METRICS)}
      </div>
    </div>
  );
}
