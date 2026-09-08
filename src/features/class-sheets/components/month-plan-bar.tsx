"use client";

import { useMemo } from "react";
import { mpDayIsOff, mpOffOverrideOf } from "../lib/month-plan";
import { mpCompareDay, mpLinesOfDate, mpSummarize } from "../lib/month-plan-compare";
import type { ClassSheetMonthData } from "../server/month-queries";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

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
          // 아직 안 온 수업일은 판정에서 뺀다 — 안 빼면 달 초에 남은 수업일이 전부 '미작성'이 된다.
          today: data.today,
        }),
      ),
    );
  }, [data, cells]);

  const t = useSheetT();
  const tf = useSheetTf();
  const pct = summary.scheduled === 0 ? 0 : Math.round((summary.planned / summary.scheduled) * 100);

  return (
    <>
      <span
        className="text-text-dim text-xs"
        title={t("mp.title")}
      >
        {t("bulk.plan")}{" "}
        <b className="text-foreground num">
          {summary.planned}/{summary.scheduled}
        </b>
        {t("mp.dayUnit")} <span className="num">({pct}%)</span>
      </span>
      {summary.unwritten > 0 ? (
        <span
          className="text-amber inline-flex items-center gap-1.5 text-xs font-bold"
          title={t("mp.unwritten.title")}
        >
          <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
          {t("mp.unwritten")} <span className="num">{tf("month.days", { n: summary.unwritten })}</span>
        </span>
      ) : null}
      {summary.offBook > 0 ? (
        <span
          className="text-amber inline-flex items-center gap-1.5 text-xs font-bold"
          title={t("mp.offBook.title")}
        >
          <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
          {t("mp.offBook")} <span className="num">{tf("month.days", { n: summary.offBook })}</span>
        </span>
      ) : null}
      {summary.noPlan > 0 ? (
        <span
          className="text-text-faint text-xs"
          title={t("mp.noPlan.title")}
        >
          {t("mp.noPlan")} <span className="num">{tf("month.days", { n: summary.noPlan })}</span>
        </span>
      ) : null}
    </>
  );
}
