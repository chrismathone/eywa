"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import {
  clampUnderstanding,
  UNDERSTANDING_DEFAULT,
  UNDERSTANDING_MAX,
  understandingPresetOf,
  type UnderstandingRow,
} from "../math-report-pilot";
import { UnderstandingPresetButtons } from "./understanding-presets";

/**
 * 소단원별 이해도(10점 만점) — 새 수학 보고서(math-report-pilot.ts) 행에서만 그린다.
 * 오늘 진도의 차시마다 한 줄. 닫기(×) 아이콘 버튼으로 빼면 자동작성에 안 들어가고 아래 '뺀 소단원'에서 되살린다.
 * 안 매긴 소단원은 기본값 10으로 읽는다(원장 2026-10-26) — 칸을 비우면 기본값으로 돌아간다. 기본값 칸은 옅게 그려 '아직 안 고침'이 보이게.
 * 맨 위 단계 버튼(우수·보통·나쁨)은 이 행의 소단원 전부를 한 번에 채운다.
 */
export function UnderstandingPanel({
  rows,
  disabled,
  onScore,
  onToggle,
  onAll,
}: {
  rows: UnderstandingRow[];
  disabled?: boolean;
  onScore: (lesson: string, score: number | null) => void;
  /** 빼기·되살리기 — off=true면 뺀다. */
  onToggle: (lesson: string, off: boolean) => void;
  /** 소단원 전부에 같은 점수(단계 버튼). */
  onAll?: (score: number) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const live = rows.filter((r) => !r.off);
  const removed = rows.filter((r) => r.off);
  // 직접 매긴 점수가 있고 모든 소단원이 한 단계 점수로 같으면 그 버튼을 눌린 것으로 보인다(표와 같은 판정 — understandingPresetOf).
  const activePreset = understandingPresetOf(rows);
  return (
    <section className="border-line flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="micro text-text-faint">{t("os.card.understanding")}</p>
        <p className="text-text-faint text-xs">{tf("os.card.understandingHintDefault", { n: UNDERSTANDING_DEFAULT })}</p>
      </div>
      {onAll && live.length ? <UnderstandingPresetButtons active={activePreset} disabled={disabled} onPick={onAll} /> : null}
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
                title={r.stored ? undefined : tf("os.card.understandingDefaultTitle", { n: UNDERSTANDING_DEFAULT })}
                className={`border-line focus:border-primary num h-8 w-14 rounded-lg border bg-background px-2 text-center text-sm outline-none disabled:opacity-50 ${
                  r.stored ? "" : "text-text-faint"
                }`}
              />
              <span className="text-text-faint text-xs">/ {UNDERSTANDING_MAX}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(r.lesson, true)}
                aria-label={tf("os.card.understandingRemove", { lesson: r.title })}
                title={tf("os.card.understandingRemove", { lesson: r.title })}
                className="text-text-faint hover:text-danger inline-flex size-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
              >
                <EyIcon name="close" size={14} />
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
