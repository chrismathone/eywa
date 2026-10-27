"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { UNDERSTANDING_GUIDE, UNDERSTANDING_PRESETS, type UnderstandingPresetKey } from "../math-report-pilot";

const LABEL_KEY = {
  good: "os.card.understandingPreset.good",
  ok: "os.card.understandingPreset.ok",
  poor: "os.card.understandingPreset.poor",
} as const satisfies Record<UnderstandingPresetKey, string>;

/**
 * 이해도 단계 버튼(우수 10 · 보통 7 · 나쁨 4) — 원장 2026-10-26 *"버튼식으로 이해도 우수 보통 나쁨 이런식으로 바로 기입"*.
 * 카드 패널(그 행 소단원 전부)과 일괄 입력(고른 행 전부)이 같은 버튼을 쓴다. 점수 값은 `UNDERSTANDING_PRESETS` 한 곳.
 * 0~10 안내(`UNDERSTANDING_GUIDE`)는 원장이 줄 예정 — 채워지면 버튼 묶음의 툴팁으로 보인다.
 */
export function UnderstandingPresetButtons({
  active,
  disabled,
  onPick,
  compact,
}: {
  active: UnderstandingPresetKey | null;
  disabled?: boolean;
  onPick: (score: number) => void;
  compact?: boolean;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const guide = UNDERSTANDING_GUIDE.map((g) => `${g.score} — ${g.text}`).join("\n");
  return (
    <div role="group" aria-label={t("os.card.understandingPresetAria")} title={guide || undefined} className="flex flex-wrap gap-1.5">
      {UNDERSTANDING_PRESETS.map((p) => {
        const on = active === p.key;
        return (
          <button
            key={p.key}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onPick(p.score)}
            title={tf("os.card.understandingPresetTitle", { label: t(LABEL_KEY[p.key]), n: p.score })}
            className={`rounded-md border font-bold disabled:opacity-50 ${compact ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-xs"} ${
              on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:border-primary bg-background"
            }`}
          >
            {t(LABEL_KEY[p.key])} <span className="num opacity-80">{p.score}</span>
          </button>
        );
      })}
    </div>
  );
}
