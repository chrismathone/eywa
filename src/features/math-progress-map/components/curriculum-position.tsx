"use client";

import { nextChapterAfter } from "../focus";
import { useProgressMap } from "./map-state";

/**
 * 커리큘럼 위치 — 학기 사다리(초6-2 → 중1-1 → 중1-2 ● → 중2-1 → 중2-2)에 현재 자리를 찍고, 다음 대단원을 적는다.
 * %가 아니라 "어디까지 왔고 다음이 무엇인가"를 답하는 칸(지시 8·18의 5번째 질문).
 */
export function CurriculumPosition() {
  const { progress, selectMonth } = useProgressMap();
  const path = progress.curriculumPath;
  const currentIdx = path.findIndex((s) => s.id === progress.currentStepId);
  const next = nextChapterAfter(progress);
  const monthsLabel = (months: number[]) => (months.length ? `${months[0]}~${months[months.length - 1]}월` : "내년");
  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <h3 className="text-foreground text-base font-bold">커리큘럼 위치</h3>
      <ol className="mt-2 flex flex-wrap items-start gap-x-1 gap-y-2">
        {path.map((s, i) => {
          const current = i === currentIdx;
          const done = i < currentIdx;
          return (
            <li key={s.id} className="flex items-start gap-1">
              <span className="flex flex-col items-center gap-0.5">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${
                    current ? "bg-primary text-primary-foreground" : done ? "bg-green-soft text-green" : "bg-bg-soft text-text-dim"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {current ? "● " : ""}
                  {s.label}
                </span>
                <span className="text-text-dim num text-xs">{monthsLabel(s.months)}</span>
              </span>
              {i < path.length - 1 ? (
                <span className="text-text-dim mt-1 text-sm" aria-hidden>
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <dl className="border-line-faint mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
        <dt className="text-text-dim font-medium">지금</dt>
        <dd className="text-foreground font-bold break-keep">
          {progress.curriculum.semester} · {progress.curriculum.chapter}
        </dd>
        <dt className="text-text-dim font-medium">다음 단원</dt>
        <dd className="text-foreground break-keep">
          {next ? (
            <button type="button" onClick={() => selectMonth(next.month)} className="hover:text-primary text-left font-bold underline-offset-2 hover:underline">
              {next.chapter} <span className="text-text-dim num font-medium">({next.month}월 · {next.bookName})</span>
            </button>
          ) : (
            "올해 계획 끝"
          )}
        </dd>
      </dl>
    </section>
  );
}
