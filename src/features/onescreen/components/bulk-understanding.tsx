"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { UNDERSTANDING_PRESETS } from "../math-report-pilot";
import { UnderstandingPresetButtons } from "./understanding-presets";

/**
 * 일괄 입력의 이해도 칸 — 단계 버튼(고른 행 소단원 전부, 원장 2026-10-26) + 뺄 소단원 고르기(원장 2026-10-27 *"몇개 선택 빼기"*).
 * 소단원 칩을 누르면 '뺌'(취소선) — 적용하면 그 소단원이 있는 행에서만 빠진다(planBulkApply). 학생마다 다른 점수는 행의 '소단원별'에서.
 */
export function BulkUnderstandingField({
  score,
  onScore,
  lessons,
  off,
  onOff,
}: {
  score: number | null;
  onScore: (score: number | null) => void;
  lessons: readonly { lesson: string; title: string; count: number }[];
  off: readonly string[];
  onOff: (off: string[]) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  return (
    <div className="flex flex-col gap-1">
      <p className="micro text-text-faint">{t("os.bulk.understanding")}</p>
      <UnderstandingPresetButtons
        compact
        active={UNDERSTANDING_PRESETS.find((p) => p.score === score)?.key ?? null}
        onPick={(s) => onScore(score === s ? null : s)}
      />
      {lessons.length ? (
        <>
          <p className="text-text-faint mt-1 text-xs">{t("os.bulk.understandingOffHint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {lessons.map((l) => {
              const isOff = off.includes(l.lesson);
              return (
                <button
                  key={l.lesson}
                  type="button"
                  aria-pressed={isOff}
                  onClick={() => onOff(isOff ? off.filter((x) => x !== l.lesson) : [...off, l.lesson])}
                  title={tf("os.bulk.understandingOffTitle", { lesson: l.title, n: l.count })}
                  className={`rounded-pill border px-2 py-0.5 text-xs break-keep ${
                    isOff ? "border-danger text-danger line-through" : "border-line text-text-dim hover:border-primary"
                  }`}
                >
                  {l.title} <span className="num opacity-70">{l.count}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
