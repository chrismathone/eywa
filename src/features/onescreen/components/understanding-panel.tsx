"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { clampUnderstanding, UNDERSTANDING_MAX, type UnderstandingRow } from "../math-report-pilot";

/**
 * 소단원별 이해도(10점 만점) — 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) 행에서만 그린다.
 * 오늘 진도의 차시마다 한 줄. ✕로 빼면 자동작성에 안 들어가고 아래 '뺀 소단원'에서 되살린다.
 * 점수를 비운 소단원도 자동작성에 안 들어간다(모르는 점수를 지어내지 않는다).
 */
export function UnderstandingPanel({
  rows,
  disabled,
  onScore,
  onToggle,
}: {
  rows: UnderstandingRow[];
  disabled?: boolean;
  onScore: (lesson: string, score: number | null) => void;
  /** 빼기·되살리기 — off=true면 뺀다. */
  onToggle: (lesson: string, off: boolean) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const live = rows.filter((r) => !r.off);
  const removed = rows.filter((r) => r.off);
  return (
    <section className="border-line flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="micro text-text-faint">{t("os.card.understanding")}</p>
        <p className="text-text-faint text-xs">{t("os.card.understandingHint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-text-dim text-sm">{t("os.card.understandingEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {live.map((r) => (
            <li key={r.lesson} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm break-keep" title={r.lesson}>
                {r.title}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={UNDERSTANDING_MAX}
                step={1}
                disabled={disabled}
                value={r.score ?? ""}
                onChange={(e) => onScore(r.lesson, clampUnderstanding(e.target.value))}
                aria-label={tf("os.card.understandingScoreAria", { lesson: r.title })}
                className="border-line focus:border-primary num h-8 w-14 rounded-lg border bg-background px-2 text-center text-sm outline-none disabled:opacity-50"
              />
              <span className="text-text-faint text-xs">/ {UNDERSTANDING_MAX}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(r.lesson, true)}
                aria-label={tf("os.card.understandingRemove", { lesson: r.title })}
                title={tf("os.card.understandingRemove", { lesson: r.title })}
                className="text-text-faint hover:text-danger size-8 shrink-0 rounded-lg text-sm disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {removed.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-faint text-xs">{t("os.card.understandingRemoved")}</span>
          {removed.map((r) => (
            <button
              key={r.lesson}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(r.lesson, false)}
              title={t("os.card.understandingRestore")}
              className="border-line text-text-dim hover:border-primary rounded-pill border px-2 py-0.5 text-xs line-through disabled:opacity-50"
            >
              {r.title}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
