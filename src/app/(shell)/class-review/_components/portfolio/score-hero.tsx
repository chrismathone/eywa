"use client";

import { useLayoutEffect, useRef } from "react";
import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { metricBar } from "@/features/teacher-portfolio/metric-bar";
import type { ItemId, Metric, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import {
  closingLabel, fmtScore, itemColor, itemLabel, itemOf, missingTag, pendingShown, periodMax, scoreColor, scoreScale, shortItems, shownItems,
} from "@/features/teacher-portfolio/view";
import { Delta } from "./parts";

/**
 * 기간 평가 점수 — 총점 원 그래프와 항목 막대(원장이 켠 지표만, 강사평가 설정의 이름·만점 그대로).
 *
 * 달이나 강사를 바꾸면 게이지가 이전 값에서 새 값으로 움직인다(원장 2026-10-12). 이 컴포넌트는 그 사이
 * 다시 마운트되지 않으므로 폭·호 길이는 CSS 전환이 하고, 숫자만 아래 훅이 이어 센다.
 */
const MOTION = "duration-700 ease-out motion-reduce:transition-none";
const BULLET_STRIPES = "repeating-linear-gradient(135deg, var(--color-bg-soft) 0 4px, var(--color-card) 4px 8px)";
/** 숫자 글자 — 가감 항목은 양수에 '+'를 붙인다(세는 도중에도 같은 규칙이라 '+-1.5'가 보이지 않는다). */
const numText = (n: number, plus: boolean) => `${plus && n > 0 ? "+" : ""}${n.toFixed(1)}`;

/** 값이 바뀌면 이전 숫자에서 새 숫자로 이어 센다. 움직임 줄이기 설정이면 바로 바꾼다. */
function useCountTo(value: number | null, plus = false) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(value);
  // 레이아웃 단계에서 시작한다 — 새 숫자가 한 프레임 먼저 보였다가 되돌아가지 않게.
  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const el = ref.current;
    if (!el || value === null || from === null || from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    const at = (k: number) => numText(from + (value - from) * (1 - (1 - k) ** 3), plus);
    el.textContent = at(0);
    let frame = requestAnimationFrame(function step(now: number) {
      const k = Math.min(1, (now - started) / 650);
      el.textContent = at(k);
      if (k < 1) frame = requestAnimationFrame(step);
    });
    // 글자는 건드리지 않는다 — 끊긴 뒤의 값은 React가 이미 써 두었다.
    return () => cancelAnimationFrame(frame);
  }, [value, plus]);
  return ref;
}

function ScoreRing({ total, max, onOpen }: { total: number | null; max: number; onOpen: () => void }) {
  // 호는 만점 대비 비율만큼 — 만점이 100점이 아니어도 같은 원을 쓴다.
  const arc = total === null || max <= 0 ? 0 : Math.min(100, Math.max(0, (total / max) * 100));
  const number = useCountTo(total);
  const ticks = scoreScale(max);
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <button type="button" onClick={onOpen} data-total={total ?? "unknown"}
        aria-label={total === null ? "합계 산출불가. 점수 근거 보기" : `잠정 점수 ${fmtScore(total)}점, ${max}점 만점. 점수 근거 보기`}
        className="focus-visible:outline-primary relative size-56 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
        <svg viewBox="0 0 240 240" aria-hidden fill="none" className="block size-full">
          <circle cx="120" cy="120" r="94" strokeWidth="34" className="stroke-bg-soft" />
          {/* 호 하나가 총점만큼만 이어진다. 0점·산출불가도 그려 두어야 달이 바뀔 때 양쪽으로 움직인다. */}
          <circle data-ring-arc cx="120" cy="120" r="94" strokeWidth="34" pathLength={100} transform="rotate(-90 120 120)"
            className={`transition-[stroke-dasharray,stroke] ${MOTION}`} style={{ strokeDasharray: `${arc} ${100 - arc}`, stroke: scoreColor(total, max) }} />
        </svg>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <small className="text-xs">{total === null ? "기간 평가 점수" : "잠정 점수"}</small>
          <strong className={`num mt-1 leading-none font-bold whitespace-nowrap ${total === null ? "text-xl" : "text-4xl"}`}>
            {total === null ? "산출불가" : <><span ref={number}>{fmtScore(total)}</span><em className="ml-1 text-sm not-italic">점</em></>}
          </strong>
          <small className="mt-2 text-xs">{total === null ? "일부 항목 확인 필요" : `${max}점 만점`}</small>
        </span>
      </button>
      <div className="w-full max-w-64">
        <div aria-hidden className="h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${scoreColor(0)}, ${scoreColor(50)}, ${scoreColor(100)})` }} />
        <div aria-hidden className="num mt-1.5 flex justify-between text-xs">
          {ticks.map((n, i) => <span key={i}>{n}{i === ticks.length - 1 ? "점" : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

function MetricRow({ metric, color, before, tag, legacy, axis, closed, onOpen }: {
  metric: Metric; color: string; before: number | null | undefined; tag: string | null; legacy: boolean; axis: boolean; closed: boolean;
  onOpen: (id: ItemId) => void;
}) {
  const plus = metric.max <= 0; // 가감 항목(만점 0)
  const number = useCountTo(metric.value, plus);
  // 가감·음수 항목은 0을 가운데 두고 +는 오른쪽, −는 왼쪽으로 비례해 그린다(원장 2026-10-16 — 모양 계산은 `metric-bar.ts`).
  const bar = metricBar(metric.value, metric.uncounted ? null : before, metric.max, axis);
  const signed = bar.signed;
  const label = itemLabel(metric);
  // 확인 대기 글은 이름 옆 칩으로 눈에 띄게(원장 2026-10-16 *"확인대기는 눈에 띄도록 라벨화"*) — 반영하기 전엔 점수에 들지 않는다.
  const waiting = metric.id === "satisfaction" ? metric.waiting ?? 0 : 0;
  return (
    <button type="button" onClick={() => onOpen(metric.id)} data-metric-row={metric.id}
      aria-label={`${label} ${metric.value === null ? (legacy ? "산출불가" : "합계에서 제외") : `${fmtScore(metric.value)}점`}${tag ? ` (${tag})` : ""}${waiting ? `, 확인 대기 ${waiting}건` : ""}, 근거 보기`}
      className="border-line-faint hover:bg-primary-softer focus-visible:outline-primary flex min-h-28 w-full flex-col justify-center border-b px-5 py-3.5 text-left focus-visible:outline-2">
      <span className="mb-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-bold">
          {label}{tag ? <small className="text-xs font-medium">{tag}</small> : null}
          {/* 마감한 달은 더 반영할 수 없다 — 주의색 대신 회색 '미확인'(누를 일이 없는데 누르라고 하지 않게). */}
          {waiting ? <Pill color={toneColor(closed ? "inert" : "caution")} className="whitespace-nowrap">{closed ? `미확인 ${waiting}건` : `확인 대기 ${waiting}건`}</Pill> : null}
        </span>
        <b className={`num leading-none font-bold whitespace-nowrap ${metric.value === null ? "text-base" : "text-xl"}`}>
          <span ref={number}>{metric.value === null ? (legacy ? "산출불가" : "제외") : numText(metric.value, plus)}</span>
          <small className="ml-1 text-xs font-medium">{metric.max > 0 ? `/ ${metric.max}점` : "가감"}</small>
        </b>
      </span>
      <span className="flex items-center gap-1.5">
        {signed ? <span aria-hidden className="num text-xs leading-none font-bold">−</span> : null}
        <span className="bg-bg-soft relative block h-2 w-full rounded-full" style={metric.value === null ? { background: BULLET_STRIPES } : undefined}>
          {/* 가운데 세로선 = 0점. */}
          {signed ? <span aria-hidden className="bg-line-strong absolute -top-1 left-1/2 h-4 w-px" /> : null}
          <span data-bar className={`absolute inset-y-0 rounded-full transition-[left,width] ${MOTION}`}
            style={{ left: `${bar.left}%`, width: `${bar.width}%`, background: color }} />
          {/* 검은 눈금 = 전월 점수. 값은 아래 증감이 말한다. */}
          {bar.before !== null ? (
            <span aria-hidden className={`bg-foreground ring-card absolute -top-1 h-4 w-[3px] ring-1 transition-[left] ${MOTION}`} style={{ left: `${bar.before}%` }} />
          ) : null}
        </span>
        {signed ? <span aria-hidden className="num text-xs leading-none font-bold">+</span> : null}
      </span>
      <span className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="min-w-0">{metric.basis}</span>
        {/* 아직 자동으로 세지 않는 항목은 증감을 비운다 — 0점끼리 견준 '0.0점'이나 '비교 불가'는 잰 것처럼 읽힌다('계산 전'은 이름 옆 꼬리표가 말한다). */}
        {metric.uncounted ? null : <Delta now={metric.value} before={before} />}
      </span>
    </button>
  );
}

/** 전월 점수 — 만점이 같고 그 달에 잰 항목일 때만 견준다(설정을 바꿔 10점 → 20점이 된 항목의 '+10'은 실적이 아니라 배점 변화다 ·
 *  계산 전이던 달의 0점은 잰 값이 아니다). */
function beforeOf(previous: StoredPeriod | undefined, m: Metric): number | null | undefined {
  const was = previous ? itemOf(previous, m.id) : undefined;
  return was && was.max === m.max && !was.uncounted ? was.value : undefined;
}

export function ScoreHero({ period, previous, signedIds, onOpenMetric, onOpenLedger }: {
  period: StoredPeriod; previous: StoredPeriod | undefined; onOpenMetric: (id: ItemId) => void; onOpenLedger: () => void;
  /** 가운데 축(0 가운데)으로 그릴 항목 — 보이는 달 전체로 정한다(가감 · 어느 달이든 음수). */
  signedIds: ReadonlySet<string>;
}) {
  const items = shownItems(period);
  const max = periodMax(period);
  // 자료가 없어 깎이거나 빠진 항목만 — '마감 대상 없음 · 만점'처럼 손해가 없는 항목은 안내에 올리지 않는다.
  const missing = shortItems(period).map(itemLabel);
  const pending = pendingShown(period).map(itemLabel);
  // 2026-10-13 전에 저장된 달 — 설정 사본이 없고, 산출불가 규칙이 그때 것이다.
  const legacy = !period.evaluation;
  return (
    <div className="bg-card shadow-card grid min-w-0 grid-cols-1 overflow-hidden rounded-2xl lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.8fr)]">
      <section className="border-line flex min-w-0 flex-col gap-4 border-b p-5 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold">기간 평가 점수</h3>
          <Pill color={period.closing.closedAt ? "neutral" : "blue"}>{closingLabel(period)}</Pill>
        </div>
        <ScoreRing total={period.total} max={max} onOpen={onOpenLedger} />
        <dl className="grid gap-2 text-xs">
          {([["합계에 든 항목", `${period.knownCount} / ${items.length}개`], ["항목 점수 합계", `${period.knownScore.toFixed(1)} / ${period.knownMax}점`], ["만점", `${max}점`]] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><dt>{k}</dt><dd className="num font-bold whitespace-nowrap">{v}</dd></div>
          ))}
        </dl>
        <p className="border-line-faint mt-auto border-t pt-3 text-xs leading-relaxed">
          {pending.length ? (
            <span className="block">
              {pending.join(" · ")} 항목은 아직 자동으로 세지 않아 정해 둔 규칙으로 매겼습니다
              {/* 마감한 달은 그때 점수로 굳는다 — 계산이 나중에 들어와도 이 달은 바뀌지 않는다(적대적 리뷰 2026-10-13). */}
              {period.closing.closedAt ? " — 이 달은 마감돼 그 점수로 굳었습니다." : " — 계산이 들어오면 진행 중인 달부터 점수가 섭니다."}
            </span>
          ) : null}
          {!missing.length
            ? (pending.length ? null : `${items.length}개 항목을 합산한 점수입니다.`)
            : legacy
              ? `${missing.join(" · ")} 항목의 근거가 더 필요합니다.`
              : `${missing.join(" · ")} 항목은 자료가 없어 정해 둔 규칙으로 매겼습니다.`}
        </p>
      </section>
      <section className="flex min-w-0 flex-col">
        <h3 className="px-5 pt-5 pb-1 text-base font-bold">항목별 점수 <span className="num text-xs font-medium">{items.length}개 · {max}점</span></h3>
        <div className="sm:[&>*]:border-line-faint grid min-w-0 grid-cols-1 sm:grid-cols-2 sm:[&>*:nth-child(odd)]:border-r">
          {items.map((m) => (
            <MetricRow key={m.id} metric={m} color={itemColor(m, items)} before={beforeOf(previous, m)} tag={missingTag(m, period)} legacy={legacy} axis={signedIds.has(m.id)} closed={Boolean(period.closing.closedAt)} onOpen={onOpenMetric} />
          ))}
        </div>
      </section>
    </div>
  );
}
