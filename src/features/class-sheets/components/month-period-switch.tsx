"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import { SHEET_SEG_BOX, sheetSegItem } from "../chrome";
import type { EcsMonthPeriod } from "../view-prefs";
import type { ClassSheetMonthData } from "../server/month-queries";

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const OPTIONS: readonly EcsMonthPeriod[] = ["month", "session"];

/**
 * EiE 계획서의 **기간 축** 전환 — `월 | 세션`(원장 2026-09-21 *"세션으로 뷰가 보일 수 있게 월/세션 전환"*).
 *
 * 🔴 모양은 바로 옆 `주간 | 달력`과 **같은 칸**(`SHEET_SEG_BOX`·`sheetSegItem`)이다 — 한 줄에 두 모양이
 *    섞이면 어느 것이 눌리는 것인지 헷갈린다.
 * 🔑 세션으로 볼 때는 **실제 기간**(`10/1~11/2`)을 옆에 적는다 — 라벨은 '10월'인데 11월 날짜가 보이는
 *    이유를 화면이 말해야 한다. 세션을 골랐는데 그 달 세션이 학원설정에 없으면(달력월로 떨어짐)
 *    **그 사실을 적는다**(조용히 달력월을 보여 주면 "세션으로 봤다"고 믿게 된다).
 * ⚠️ 창은 서버가 정한다(`getClassSheetMonth` → `resolvePeriodWindow`) — 여기선 받은 값만 그린다.
 */
export function MonthPeriodSwitch({
  period,
  onSelect,
}: {
  period: ClassSheetMonthData["period"];
  onSelect: (next: EcsMonthPeriod) => void;
}) {
  const t = useSheetT();
  const fellBack = period.mode === "session" && period.kind === "month";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className={SHEET_SEG_BOX} role="group" aria-label={t("month.period.aria")}>
        {OPTIONS.map((opt) => {
          const active = opt === period.mode;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              title={t(opt === "month" ? "month.period.month.title" : "month.period.session.title")}
              onClick={() => {
                if (!active) onSelect(opt);
              }}
              className={sheetSegItem(active)}
            >
              {t(opt === "month" ? "month.period.month" : "month.period.session")}
            </button>
          );
        })}
      </span>
      {fellBack ? (
        <span className="text-text-dim text-xs" title={t("month.period.noSession.title")}>
          {t("month.period.noSession")}
        </span>
      ) : period.kind === "session" ? (
        <span className="text-text-dim num text-xs">
          {shortDate(period.start)}~{shortDate(period.end)}
        </span>
      ) : null}
    </span>
  );
}
