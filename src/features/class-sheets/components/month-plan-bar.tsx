"use client";

import { useMemo } from "react";
import { mpDayIsOff, mpOffOverrideOf } from "../lib/month-plan";
import { mpCompareDay, mpLinesOfDate, mpSummarize } from "../lib/month-plan-compare";
import type { ClassSheetMonthData } from "../server/month-queries";

/**
 * 계획(MP) 보기의 **숫자 한 줄** — 작성률 + 신호 둘.
 *
 * 🔴 축이 **날짜**다(달력·진도표의 '교시'가 아니다). 같은 자리에 다른 단위를 적으면 두 숫자가 서로를
 *    반박하므로, MP 보기에서는 교시 작성률 대신 이 줄이 선다.
 * 🔴 숫자는 **표시 토글('실제 함께 보기')과 무관**하다 — 접는 것만으로 신호가 사라지면 안 된다.
 * 🔴 판정은 [`mpCompareDay`](../lib/month-plan-compare.ts) 한 곳(표의 배지와 같은 답을 낸다).
 */
export function MonthPlanBar({ data, cells }: { data: ClassSheetMonthData; cells: Record<string, string> }) {
  const summary = useMemo(() => {
    // 대상은 **배정이 있는 날**뿐(수업이 없는 날엔 계획을 적을 칸 자체가 없다).
    const dates = Object.keys(data.slotsByDate).sort();
    return mpSummarize(
      dates.map((date) =>
        mpCompareDay({
          date,
          cells,
          lines: mpLinesOfDate(data, date),
          isOff: mpDayIsOff(date, data.holidays, mpOffOverrideOf(cells, date)),
        }),
      ),
    );
  }, [data, cells]);

  const pct = summary.scheduled === 0 ? 0 : Math.round((summary.planned / summary.scheduled) * 100);

  return (
    <>
      <span
        className="text-text-dim text-[12.5px]"
        title="휴강으로 표시한 날은 분모에서 빠집니다. 달력·진도표의 '계획 N/M교시'는 축이 교시라 이 숫자와 다릅니다."
      >
        계획{" "}
        <b className="text-foreground num">
          {summary.planned}/{summary.scheduled}
        </b>
        일 <span className="num">({pct}%)</span>
      </span>
      {summary.unwritten > 0 ? (
        <span
          className="text-amber inline-flex items-center gap-1.5 text-[12.5px] font-bold"
          title="계획은 적었는데 그 날 주간 시트에 기록이 없는 날입니다"
        >
          <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
          미작성 <span className="num">{summary.unwritten}일</span>
        </span>
      ) : null}
      {summary.offBook > 0 ? (
        <span
          className="text-amber inline-flex items-center gap-1.5 text-[12.5px] font-bold"
          title="계획에 적은 교재가 그 날 기록 어디에도 없는 날입니다(쪽수는 대조하지 않습니다)"
        >
          <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
          교재 다름 <span className="num">{summary.offBook}일</span>
        </span>
      ) : null}
      {summary.noPlan > 0 ? (
        <span
          className="text-text-faint text-[12.5px]"
          title="기록은 있는데 계획 칸이 비어 있는 날입니다 — 경고가 아닙니다"
        >
          계획 없음 <span className="num">{summary.noPlan}일</span>
        </span>
      ) : null}
    </>
  );
}
