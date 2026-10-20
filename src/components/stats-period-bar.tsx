"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ToolbarButton, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { PeriodNav } from "@/components/period-nav";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { monthLabel, shiftMonth } from "@/lib/date-kst";
import {
  MAX_DAY_SPAN,
  paramsForMode,
  periodModeOf,
  periodQuery,
  PERIOD_KEYS,
  type PeriodKeys,
  type PeriodMode,
  type PeriodParams,
  type StatsPeriod,
} from "@/features/stats/period";

const MODE_LABEL: Record<PeriodMode, string> = { month: "12개월", month24: "24개월", day: "일별", range: "구간" };
const DATE_INPUT = `border-line-strong num ${CONTROL_H} ${CONTROL_LABEL} rounded-lg border bg-transparent px-2 outline-none focus:border-primary`;

/**
 * 통계 카드의 **기간 막대 한 벌**(원장 2026-10-20 *"월별에서 일자별로 … 하나의 월을 선택해서 해당월을 일자별로 / 혹은 구간을 잡아서
 * 한달치정도를 일자별로"*) — `월별 12개월 · 24개월 · 일별(‹ 2026년 9월 ›) · 구간(시작일~끝일, 최대 31일)`.
 * 기간은 **주소**에 싣고(서버가 그 기간을 센다) 방식은 `onMode`로 계정에 남긴다. 이동은 PeriodNav와 같은 `startTransition` +
 * `router.push`라 보던 그래프를 지우지 않고 새 값을 받는다 · 창 안이면 `embed=1`을 싣는다([[#133]]).
 * `keys` = 그 화면이 쓰는 주소 이름(목록 필터와 겹치지 않게) · `keep` = 기간 밖 쿼리(그대로 둔다) · `anchor` = 카드 자리(`#intake`).
 */
export function StatsPeriodBar({
  period,
  today,
  keys = PERIOD_KEYS,
  keep,
  anchor = "",
  onMode,
  modes = ["month", "month24", "day", "range"],
}: {
  period: StatsPeriod;
  today: string;
  keys?: PeriodKeys;
  keep: Record<string, string | undefined>;
  anchor?: string;
  onMode?: (mode: PeriodMode) => void;
  /** 고를 수 있는 방식 — 하루로 나눌 수 없는 지표(수납)는 월별만. */
  modes?: readonly PeriodMode[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const embed = useEmbed();
  const [pending, startTransition] = useTransition();
  const mode = periodModeOf(period);
  const [from, setFrom] = useState(period.grain === "day" ? period.from : "");
  const [to, setTo] = useState(period.grain === "day" ? period.to : "");
  const hrefOf = (next: PeriodParams) => {
    const href = `${pathname}${periodQuery(next, keep, keys)}${anchor}`;
    return embed ? withEmbed(href) : href;
  };
  const go = (next: PeriodParams) => startTransition(() => router.push(hrefOf(next), { scroll: false }));
  const pick = (next: PeriodMode) => {
    onMode?.(next);
    const params = paramsForMode(next, today);
    if (next === "range") {
      setFrom(params.from!);
      setTo(params.to!);
    }
    go(params);
  };
  const month = period.grain === "day" ? period.month : null;
  const thisMonth = today.slice(0, 7);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
      <ToolbarSegment label="기간">
        {modes.map((m) => (
          <ToolbarSegmentItem key={m} active={mode === m} onClick={() => mode !== m && pick(m)}>
            {MODE_LABEL[m]}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
      {month ? (
        <PeriodNav
          label={monthLabel(month)}
          prevHref={hrefOf({ grain: "day", month: shiftMonth(month, -1) })}
          nextHref={hrefOf({ grain: "day", month: shiftMonth(month, 1) })}
          currentHref={hrefOf({ grain: "day", month: thisMonth })}
          relation={month < thisMonth ? "past" : "current"}
          nextDisabled={month >= thisMonth}
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
        />
      ) : null}
      {mode === "range" ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) go({ grain: "day", from, to });
          }}
        >
          <input type="date" aria-label="시작일" className={DATE_INPUT} value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">~</span>
          <input type="date" aria-label="끝일" className={DATE_INPUT} value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <ToolbarButton type="submit" disabled={!from || !to}>
            보기
          </ToolbarButton>
          <span className="text-muted-foreground text-xs">최대 {MAX_DAY_SPAN}일</span>
        </form>
      ) : null}
    </div>
  );
}
