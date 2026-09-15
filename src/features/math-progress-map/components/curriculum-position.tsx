"use client";

import { useMemo } from "react";
import { nextChapterAfter } from "../focus";
import type { RoadmapStep } from "../model";
import { formatYearMonth, monthKey } from "../years";
import { CurriculumCarousel } from "./curriculum-carousel";
import { useProgressMap } from "./map-state";

/** 입학~종강의 과정 슬라이더와 실제 현재 위치. 과정 선택은 원형 지도의 연도와 월도 함께 바꾼다. */
export function CurriculumPosition() {
  const { sourceProgress: progress, selectPeriod } = useProgressMap();
  const steps = useMemo<RoadmapStep[]>(() => progress.roadmap?.steps ?? progress.curriculumPath.map((s) => ({
    id: s.id, label: s.label, group: "커리큘럼", estimated: false, description: "",
    startMonth: s.months.length ? monthKey(progress.year, s.months[0]!) : "",
    endMonth: s.months.length ? monthKey(progress.year, s.months[s.months.length - 1]!) : "",
  })), [progress.roadmap, progress.curriculumPath, progress.year]);
  const first = steps[0];
  const last = steps.at(-1);
  const next = nextChapterAfter(progress);
  const jumpTo = (date: string) => selectPeriod(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  return (
    <section className="bg-card shadow-card min-w-0 rounded-2xl p-4" aria-label="입학부터 종강까지">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-foreground text-base font-bold">입학부터 종강까지</h3>
        {first?.startMonth && last?.endMonth ? (
          <p className="text-foreground num flex flex-wrap items-center gap-x-2 text-sm font-bold">
            <button type="button" onClick={() => jumpTo(progress.roadmap?.enrolledOn.slice(0, 7) ?? first.startMonth)} className="hover:text-primary rounded underline-offset-2 hover:underline">{formatYearMonth(progress.roadmap?.enrolledOn.slice(0, 7) ?? first.startMonth)} 입학</button>
            <span className="text-text-dim" aria-hidden>→</span>
            <button type="button" onClick={() => jumpTo(last.endMonth)} className="text-primary rounded underline-offset-2 hover:underline">{formatYearMonth(last.endMonth)} {progress.roadmap?.targetLabel ?? last.label} 종강 예상</button>
          </p>
        ) : null}
      </div>
      {progress.roadmap ? <p className="text-text-dim mt-1 text-xs leading-relaxed">{progress.roadmap.estimateNote}</p> : null}
      <CurriculumCarousel steps={steps} />
      <dl className="border-line-faint mt-4 grid gap-3 border-t pt-3 text-sm lg:grid-cols-2 lg:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <dt className="text-text-dim shrink-0 pt-0.5 text-xs font-bold">지금 학습</dt>
          <dd className="min-w-0">
            <p className="text-foreground font-bold break-keep">{progress.curriculum.bookName} · {progress.curriculum.chapter}</p>
            <p className="text-text-dim mt-1 text-xs break-keep">
              {progress.curriculum.subChapter ? `${progress.curriculum.subChapter} · ` : ""}
              <span className="num whitespace-nowrap">p.{progress.curriculum.currentPage} / {progress.curriculum.totalPages}</span>
            </p>
          </dd>
        </div>
        <div className="flex min-w-0 items-start gap-3">
          <dt className="text-text-dim shrink-0 pt-0.5 text-xs font-bold">다음 단원</dt>
          <dd className="min-w-0">
            {next ? (
              <button type="button" onClick={() => selectPeriod(progress.year, next.month)} className="text-foreground hover:text-primary rounded text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span className="block font-bold break-keep">{next.bookName} · {next.chapter} <span aria-hidden>→</span></span>
                <span className="text-text-dim num mt-1 block text-xs">{progress.year}.{String(next.month).padStart(2, "0")} · p.{next.startPage}~{next.endPage}</span>
              </button>
            ) : <span className="text-foreground">올해 계획 끝</span>}
          </dd>
        </div>
      </dl>
    </section>
  );
}
