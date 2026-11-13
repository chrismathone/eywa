"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { yyMm, type ChurnMonth, type ChurnTeacherRow } from "@/features/withdrawals/teacher-churn";
import {
  autoEmphasis, chartMonths, dupName, monthBrief, nearestAt, pointsOf, segmentsOf, spreadLabels,
} from "@/features/withdrawals/teacher-churn-view";
import { TeacherChurnChartList } from "./teacher-churn-chart-list";
import { CONTEXT_COLOR, LINE_COLORS } from "./teacher-churn-colors";

/** 강조 밖 강사를 가리킬 때의 선 색(강조 색과 겹치지 않게 앱 기본 남색). */
const HOVER_COLOR = "var(--primary)";
/** 마우스가 이만큼(px) 안에 들어온 선을 가리킨 것으로 본다. */
const HIT_PX = 10;
/** 선 끝 이름표 사이 최소 간격(세로 %) — 그림 영역 약 220px 기준 글자 한 줄(약 20px). */
const LABEL_GAP = 9;

/**
 * '강사별 퇴원율 추이' **차트 보기** — 모든 강사를 한 차트에(원장 2026-11-12 *"전체 선생님을 하나의 차트에 … 비교가능하게"*).
 * 나머지 강사 = 옅은 회색 선 · 강조 셋 = 표에서 고른 강사(같은 색), 없으면 마지막 달 퇴원율 높은 3명(`autoEmphasis`) — 선 끝에 이름.
 * 마우스 = 그 달 세로줄 + 가장 가까운 선을 진하게 · 누르면 그 강사를 고정(표와 같은 고르기 · 셋까지) · 빈 곳을 누르거나 좌우 화살표 = 달 고정.
 * 오른쪽 목록 = 고른 달(없으면 마지막 달)의 모든 강사 값(표 칸과 같은 상태 이름). 점 = 마감한 퇴원율만 · 빈 달을 건너 잇지 않는다.
 */
export function TeacherChurnChart({ rows, months, ceil, picked, onPick, onClearPicks, portfolioLink }: {
  rows: readonly ChurnTeacherRow[];
  months: readonly ChurnMonth[];
  /** 세로 눈금 끝(%) — 카드가 `chartCeil`로 재서 범례와 함께 쓴다. */
  ceil: number;
  /** 고른 강사 id(고른 차례 = 색 차례) — 지금 보이는 강사만. */
  picked: readonly string[];
  onPick: (id: string) => void;
  onClearPicks: () => void;
  portfolioLink: boolean;
}) {
  const axis = chartMonths(months);
  const n = axis.length;
  // 고정한 달 — 달 글자 + 그때의 축으로 들고 있다(기간·필터가 바뀌면 풀린다 · 되돌려도 되살아나지 않게).
  const axisKey = axis.map((m) => m.month).join(",");
  const [sticky, setSticky] = useState<{ month: string; axisKey: string } | null>(null);
  // 가리키는 중 — k = 차트 위 마우스의 달(목록 이름에 올리면 null) · id = 가리킨 강사.
  const [hover, setHover] = useState<{ k: number | null; id: string | null; axisKey: string } | null>(null);
  if (!n) return <p className="bg-bg-soft rounded-lg px-4 py-3 text-sm" role="status">고른 기간에 마감한 달이 없습니다.</p>;

  const stickyK = sticky && sticky.axisKey === axisKey ? axis.findIndex((m) => m.month === sticky.month) : -1;
  const live = hover && hover.axisKey === axisKey && (hover.k === null || hover.k < n) ? hover : null;
  const hoverK = live?.k ?? null;
  const activeK = hoverK !== null ? hoverK : stickyK >= 0 ? stickyK : n - 1;
  const hoverId = live?.id ?? null;
  const series = rows.map((r) => ({ row: r, pts: pointsOf(r, axis) }));
  const names = new Map(rows.map((r, i) => [r.id, dupName(rows, i)]));
  const emph = picked.length ? [...picked] : autoEmphasis(rows, axis[n - 1]!.month);
  const colorOf = (id: string): string | null => { const i = emph.indexOf(id); return i < 0 ? null : LINE_COLORS[i] ?? null; };
  const xPct = (k: number) => ((k + 0.5) / n) * 100;
  const yPct = (rate: number) => 100 - (Math.min(rate, ceil) / ceil) * 100;

  const locate = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const k = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n)));
    const target = (1 - (e.clientY - box.top) / box.height) * ceil;
    const id = nearestAt(series.map((s) => ({ id: s.row.id, rate: s.pts[k]?.rate ?? null })), target, (HIT_PX / box.height) * ceil);
    return { k, id };
  };
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const { k, id } = locate(e);
    if (!live || hoverK !== k || live.id !== id) setHover({ k, id, axisKey });
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const { k, id } = locate(e);
    if (id) onPick(id);
    else setSticky(stickyK === k ? null : { month: axis[k]!.month, axisKey });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setSticky(null); return; }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const base = stickyK >= 0 ? stickyK : n - 1;
    setSticky({ month: axis[Math.min(n - 1, Math.max(0, base + (e.key === "ArrowLeft" ? -1 : 1)))]!.month, axisKey });
  };

  // 그리는 차례 = 회색 바탕 → 강조 → 가리킨 선(맨 위).
  const rank = (id: string) => (id === hoverId ? 2 : colorOf(id) ? 1 : 0);
  const order = [...series].sort((a, b) => rank(a.row.id) - rank(b.row.id));
  const strokeOf = (id: string) => colorOf(id) ?? (id === hoverId ? HOVER_COLOR : CONTEXT_COLOR);
  // 강조 밖 선은 강조가 있으면 더 옅게(원장 2026-11-12 *"선택하지 않은 강사들이 더 연해지게"*) · 가리키는 중이면 한 번 더.
  const rest = emph.length ? 0.4 : 1;
  const fade = (id: string) =>
    id === hoverId ? 1 : colorOf(id) ? (hoverId ? 0.35 : 1) : hoverId ? rest * 0.6 : rest;
  const marked = order.filter((s) => colorOf(s.row.id) || s.row.id === hoverId);
  // 선 끝 이름표 — 강조·가리킨 선만 · 끝 달이 같은 이름표끼리 겹치지 않게 벌린다.
  const ends = marked.flatMap((s) => {
    const last = s.pts.findLastIndex((p) => p !== null);
    return last < 0 ? [] : [{ id: s.row.id, last, y: yPct(s.pts[last]!.rate) }];
  });
  const labelY = new Map<string, number>();
  for (const k of new Set(ends.map((e) => e.last))) {
    for (const [id, y] of spreadLabels(ends.filter((e) => e.last === k), LABEL_GAP)) labelY.set(id, y);
  }
  const hoverRow = hoverId ? rows.find((r) => r.id === hoverId) : undefined;
  const active = axis[activeK]!;
  const everyOther = n > 12;
  // 세로 눈금 — 5(20% 이하) 또는 10 간격 + 끝값(끝값은 늘 5의 배수라 소수점이 안 생긴다).
  const step = ceil <= 20 ? 5 : 10;
  const ticks = [...Array.from({ length: Math.floor(ceil / step) + 1 }, (_, i) => i * step).filter((v) => v < ceil), ceil];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        <div className="mb-1 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {picked.length ? (
            <>
              <span>강조 = 고른 강사 {picked.length}명(셋까지)</span>
              <button type="button" onClick={onClearPicks} className="text-primary font-semibold hover:underline">고른 강사 지우기</button>
            </>
          ) : (
            <span>{emph.length ? `강조 = ${yyMm(axis[n - 1]!.month)} 퇴원율 높은 ${emph.length}명 · ` : ""}선이나 이름을 누르면 그 강사를 강조합니다</span>
          )}
          <span aria-live="polite" className="num ml-auto font-semibold">
            {hoverRow ? `${names.get(hoverRow.id)} · ${yyMm(active.month)} · ${monthBrief(hoverRow, active.month, hoverRow.cells[active.month])}` : ""}
          </span>
        </div>
        <div className="relative h-64">
          <div className="absolute top-2 right-24 bottom-7 left-10">
            {ticks.map((v) => (
              <div key={v} aria-hidden className={`absolute inset-x-0 border-t ${v ? "border-line-faint border-dashed" : "border-line"}`} style={{ top: `${yPct(v)}%` }}>
                <span className="num absolute right-full -translate-y-1/2 pr-1.5 text-xs whitespace-nowrap">{v}%</span>
              </div>
            ))}
            {/* 달마다 연한 세로 점선(원장 2026-11-12 *"각 월별 세로 점선 연하게"*) — 같은 달 값을 위아래로 짚기 쉽게. */}
            {axis.map((m, k) => (
              <span key={m.month} aria-hidden className="border-line-faint absolute inset-y-0 border-l border-dashed" style={{ left: `${xPct(k)}%` }} />
            ))}
            {hoverK !== null || stickyK >= 0 ? (
              <span aria-hidden className="bg-primary-softer absolute inset-y-0" style={{ left: `${(activeK / n) * 100}%`, width: `${100 / n}%` }} />
            ) : null}
            <svg aria-hidden className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none">
              {order.map((s) => segmentsOf(s.pts).filter((g) => g.length > 1).map((g) => (
                <polyline key={`${s.row.id}:${g[0]}`} fill="none" stroke={strokeOf(s.row.id)} opacity={fade(s.row.id)}
                  strokeWidth={s.row.id === hoverId ? 3 : colorOf(s.row.id) ? 2.25 : 1.5} vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round" strokeLinecap="round" points={g.map((k) => `${k + 0.5},${yPct(s.pts[k]!.rate)}`).join(" ")} />
              )))}
            </svg>
            {marked.map((s) => s.pts.map((p, k) => p ? (
              <span key={`${s.row.id}:${k}`} aria-hidden style={{ left: `${xPct(k)}%`, top: `${yPct(p.rate)}%`, borderColor: strokeOf(s.row.id), background: p.small ? "var(--card)" : strokeOf(s.row.id), opacity: fade(s.row.id) }}
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
            ) : null))}
            {ends.map((e) => (
              <span key={e.id} aria-hidden style={{ left: `calc(${xPct(e.last)}% + 0.6rem)`, top: `${labelY.get(e.id) ?? e.y}%`, opacity: fade(e.id) }}
                className="bg-card/85 absolute flex -translate-y-1/2 items-center gap-1 rounded-sm px-0.5 text-xs font-semibold whitespace-nowrap">
                <i className="h-0.5 w-2.5 rounded-full" style={{ background: strokeOf(e.id) }} />{names.get(e.id)}
              </span>
            ))}
            {/* 마우스·탭 = 그 달 + 가장 가까운 선 · 누르기 = 고정(선 위면 강사, 빈 곳이면 달) · 키보드 = 좌우 화살표로 달. */}
            <div tabIndex={0} role="group" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} onKeyDown={onKey}
              aria-label="강사별 퇴원율 차트 — 좌우 화살표로 달을 고르면 옆 목록이 그 달 값으로 바뀝니다"
              className={`focus-visible:outline-primary absolute inset-0 rounded-sm focus-visible:outline-2 ${hoverId ? "cursor-pointer" : ""}`} />
            <div aria-hidden className="absolute inset-x-0 top-full mt-1.5">
              {axis.map((m, k) => everyOther && k % 2 !== (n - 1) % 2 && k !== activeK ? null : (
                <span key={m.month} style={{ left: `${xPct(k)}%` }}
                  className={`num absolute -translate-x-1/2 text-xs whitespace-nowrap ${k === activeK ? "font-bold" : ""}`}>{yyMm(m.month)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <TeacherChurnChartList rows={rows} month={active} names={names} colorOf={colorOf} picked={picked} hoverId={hoverId}
        onHover={(id) => setHover(id ? { k: null, id, axisKey } : null)} onPick={onPick} portfolioLink={portfolioLink} />
    </div>
  );
}
