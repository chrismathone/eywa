"use client";

import { formatDotDate } from "../calendar";
import { focusOfDate, resolveWeek, summaryRows } from "../focus";
import { paceLabel } from "../pace";
import { useProgressMap } from "./map-state";
import styles from "./progress-map.module.css";

/**
 * 진도 요약 — 일·주·월·분기·연 다섯 줄(가로 막대). 초점을 따라가고(2월을 누르면 2월 숫자), 지금 보기 단위의
 * 줄이 켜진다. 줄을 누르면 그 단위로 바뀐다. 아래엔 현재 교재·단원·이번 주 목표·현재 쪽.
 * 막대는 한 색(학원색)이다 — 다섯 줄은 같은 것을 다른 배율로 본 것이라 색으로 가를 이유가 없다.
 */
export function ProgressSummary() {
  const { view, currentView, sourceProgress, focus, mode, setMode, progress, pace } = useProgressMap();
  const rows = summaryRows(view, focus);
  const thisWeek = resolveWeek(currentView, focusOfDate(sourceProgress.asOf, sourceProgress.year));
  const c = progress.curriculum;
  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-foreground text-base font-bold">{view.year}년 {progress.estimated ? "예상 진도" : "진도 요약"}</h3>
        <span className="text-text-dim num text-xs">{formatDotDate(progress.asOf)} 기준</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {rows.map((r) => {
          const on = r.mode === mode;
          return (
            <li key={r.mode}>
              <button
                type="button"
                onClick={() => setMode(r.mode)}
                aria-pressed={on}
                className={`${styles.selectionItem} grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-bg-soft`}
              >
                <span className="min-w-0">
                  <span className="text-foreground block text-sm leading-tight font-bold">{r.label}</span>
                  <span className="text-text-dim block truncate text-xs leading-tight font-medium">{r.caption}</span>
                </span>
                <span className="bg-bg-soft block h-2.5 overflow-hidden rounded-full" aria-hidden>
                  <span className="bg-primary block h-full rounded-full transition-[width] duration-300" style={{ width: `${r.pct}%` }} />
                </span>
                <span className="num text-sm whitespace-nowrap">
                  <span className="text-text-dim">
                    {r.done} / {r.planned}
                  </span>{" "}
                  <span className="text-foreground inline-block w-11 text-right font-bold">{r.pct}%</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <dl className="border-line-faint mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
        <dt className="text-text-dim font-medium">현재 교재</dt>
        <dd className="text-foreground font-bold">{c.bookName}</dd>
        <dt className="text-text-dim font-medium">현재 단원</dt>
        <dd className="text-foreground font-bold break-keep">{c.chapter}</dd>
        <dt className="text-text-dim font-medium">계획 대비</dt>
        <dd className="text-foreground font-bold">{paceLabel(pace)}</dd>
        <dt className="text-text-dim font-medium">이번 주 목표</dt>
        <dd className="text-foreground num">{thisWeek.pageFrom != null ? `p.${thisWeek.pageFrom} → p.${thisWeek.pageTo}` : "계획 없음"}</dd>
        <dt className="text-text-dim font-medium">현재</dt>
        <dd className="text-foreground num font-bold">p.{c.currentPage}</dd>
      </dl>
    </section>
  );
}
