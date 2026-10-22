"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import {
  MAKEUP_TEST_REASONS,
  TEST_SKIP_REASONS,
  type DailyTestSkip,
  type TestSkipReason,
} from "../math-report-pilot-sections";

const REASON_KEY: Record<TestSkipReason, SheetDictKey> = {
  sick: "os.card.testSkip.sick",
  slow: "os.card.testSkip.slow",
  parent: "os.card.testSkip.parent",
  teacher: "os.card.testSkip.teacher",
  other: "os.card.testSkip.other",
};

/**
 * 일일 테스트 있음/없음 + 안 친 사유 — 수학 보고서 시범(테스트 학생 한정, math-report-pilot-sections.ts) 행에서만 그린다.
 * '없음'이면 사유를 골라야 발송된다(발송 게이트 `testreason`). 고른 사유 문장은 보고서 '일일 테스트' 항목에 그대로 들어간다.
 */
export function DailyTestSkipPanel({
  skip,
  disabled,
  onChange,
}: {
  skip: DailyTestSkip | null;
  disabled?: boolean;
  /** null = 시험 있음. */
  onChange: (skip: DailyTestSkip | null) => void;
}) {
  const t = useSheetT();
  const pill = (on: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim bg-background"
    }`;
  return (
    <section className="border-line flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro text-text-faint">{t("os.card.testSkip.title")}</p>
        <div className="flex gap-1" role="group" aria-label={t("os.card.testSkip.title")}>
          <button type="button" disabled={disabled} aria-pressed={!skip} className={pill(!skip)} onClick={() => onChange(null)}>
            {t("os.card.testSkip.yes")}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={!!skip}
            className={pill(!!skip)}
            onClick={() => !skip && onChange({ reason: null, detail: "" })}
          >
            {t("os.card.testSkip.no")}
          </button>
        </div>
      </div>
      {skip ? (
        <>
          <p className="text-text-faint text-xs">{t("os.card.testSkip.reasonLabel")}</p>
          <div className="flex flex-wrap gap-1">
            {TEST_SKIP_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={disabled}
                aria-pressed={skip.reason === r}
                className={pill(skip.reason === r)}
                onClick={() => onChange({ ...skip, reason: r })}
              >
                {t(REASON_KEY[r])}
              </button>
            ))}
          </div>
          <input
            type="text"
            disabled={disabled}
            value={skip.detail}
            maxLength={200}
            onChange={(e) => onChange({ ...skip, detail: e.target.value })}
            placeholder={skip.reason === "other" ? t("os.card.testSkip.detailPhOther") : t("os.card.testSkip.detailPh")}
            aria-label={t("os.card.testSkip.detailAria")}
            className="border-line focus:border-primary h-8 rounded-lg border bg-background px-2 text-sm outline-none disabled:opacity-50"
          />
          {skip.reason && MAKEUP_TEST_REASONS.includes(skip.reason) ? (
            <p className="text-text-dim text-xs">{t("os.card.testSkip.makeupHint")}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
