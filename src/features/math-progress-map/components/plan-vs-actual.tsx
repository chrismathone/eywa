"use client";

import { TONE_TEXT } from "@/lib/design/semantic-color";
import { formatMd } from "../calendar";
import { PACE_META, paceLabel } from "../pace";
import { useProgressMap } from "./map-state";

/**
 * 계획 대비 실제 — 계획 위치(속 빈 점)와 실제 위치(찬 점)를 **교재 한 줄** 위에 찍는다. 두 점의 거리가 곧 빠름/느림이고
 * 글자(↑ 12일 빠름)가 색과 함께 선다(색만으로 가르지 않는다).
 */
export function PlanVsActual() {
  const { progress, pace } = useProgressMap();
  // 축 = **계획 구간**(시작 쪽 ~ 목표 쪽) — 점 위치와 양 끝 라벨이 같은 축을 써야 한다(교재 전체 쪽수로 놓으면 계획이
  // p.1~180이 아닌 실데이터에서 점과 라벨이 어긋난다).
  const { startPage, targetPage } = progress.plan;
  const span = Math.max(1, targetPage - startPage);
  const pct = (page: number) => `${Math.max(0, Math.min(100, ((page - startPage) / span) * 100))}%`;
  const meta = PACE_META[pace.status];
  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-foreground text-base font-bold">계획 대비 실제</h3>
        <span className={`text-lg font-bold ${TONE_TEXT[meta.tone]}`}>{paceLabel(pace)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="border-line-faint rounded-xl border px-3 py-2">
          <p className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
            <span className="border-primary inline-block size-3 rounded-full border-2 bg-white" aria-hidden />
            계획 위치
          </p>
          <p className="text-foreground mt-0.5 text-sm font-bold break-keep">{pace.plannedChapter}</p>
          <p className="text-text-dim num text-xs">p.{pace.plannedPage}</p>
        </div>
        <div className="border-line-faint rounded-xl border px-3 py-2">
          <p className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
            <span className="bg-primary inline-block size-3 rounded-full" aria-hidden />
            실제 위치
          </p>
          <p className="text-foreground mt-0.5 text-sm font-bold break-keep">{pace.actualChapter}</p>
          <p className="text-foreground num text-xs font-bold">p.{pace.actualPage}</p>
        </div>
      </div>
      <div className="relative mt-4 h-3 rounded-full bg-bg-soft" aria-hidden>
        <div className="bg-green absolute inset-y-0 left-0 rounded-full" style={{ width: pct(pace.actualPage) }} />
        <span
          className="border-primary absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
          style={{ left: pct(pace.plannedPage) }}
          title={`계획 p.${pace.plannedPage}`}
        />
        <span
          className="bg-primary absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-card"
          style={{ left: pct(pace.actualPage) }}
          title={`실제 p.${pace.actualPage}`}
        />
      </div>
      <div className="text-text-dim num mt-1 flex justify-between text-xs">
        <span>p.{startPage}</span>
        <span>{progress.curriculum.bookName}</span>
        <span>p.{targetPage}</span>
      </div>
      <p className="text-text-dim num mt-2 text-xs">
        계획 {formatMd(progress.plan.startDate)} → {formatMd(progress.plan.targetDate)} · 하루 {pace.pagesPerDay}쪽 기준
      </p>
    </section>
  );
}
