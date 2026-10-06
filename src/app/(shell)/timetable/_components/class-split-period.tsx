"use client";

import { PERIOD_KIND_LABEL, type SplitPeriodKind } from "@/features/class-splits/rules";

/** 서버 액션 `createClassSplit`의 `period`와 같은 모양(그대로 넘긴다). */
export type PeriodChoice = { kind: "day"; date: string } | { kind: "month"; month: string } | { kind: "forever"; from: string };

/**
 * 나누기 **기간** 고르기 — 일별(그 날 하루) · 월별(그 달 = 학원 세션 기간, 미정의면 달력월) · 영구(그 날부터 해제할 때까지).
 * 원장 2026-10-06 *"기간도 뭐 일별 월별 영구적 지정 가능하게"*. 과거는 못 고른다(서버도 같은 규칙으로 거절한다).
 */
export function SplitPeriodFields({
  value,
  onChange,
  today,
  anchor,
}: {
  value: PeriodChoice | null;
  onChange: (v: PeriodChoice) => void;
  today: string;
  /** 기본값 기준일 — 보고 있는 주(오늘보다 앞이면 오늘). 일별·영구의 첫 날짜, 월별의 첫 달. */
  anchor: string;
}) {
  const kind = value?.kind ?? "day";
  const pick = (k: SplitPeriodKind) => {
    if (k === kind) return;
    if (k === "day") onChange({ kind: "day", date: anchor });
    else if (k === "month") onChange({ kind: "month", month: anchor.slice(0, 7) });
    else onChange({ kind: "forever", from: anchor });
  };
  const input = "border-line h-8 rounded-lg border px-2 text-sm";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-text-dim w-9 shrink-0 text-xs">기간</span>
        <div className="border-line inline-flex rounded-lg border p-0.5">
          {(["day", "month", "forever"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              aria-pressed={k === kind}
              className={`h-7 rounded-md px-3 text-xs font-medium transition ${
                k === kind ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
              }`}
            >
              {PERIOD_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-11">
        {value?.kind === "day" ? (
          <input type="date" aria-label="나누는 날" min={today} value={value.date} className={input}
            onChange={(e) => onChange({ kind: "day", date: e.target.value })} />
        ) : value?.kind === "month" ? (
          <>
            <input type="month" aria-label="나누는 달" min={today.slice(0, 7)} value={value.month} className={input}
              onChange={(e) => onChange({ kind: "month", month: e.target.value })} />
            <span className="text-text-faint text-xs">그 달 세션 기간</span>
          </>
        ) : value?.kind === "forever" ? (
          <>
            <input type="date" aria-label="시작 날짜" min={today} value={value.from} className={input}
              onChange={(e) => onChange({ kind: "forever", from: e.target.value })} />
            <span className="text-text-faint text-xs">부터 해제할 때까지</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
