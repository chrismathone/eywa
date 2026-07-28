import { ParamLink } from "./param-link";
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { addWeeks, thisMonday, weekLabel, weekRelation } from "@/features/timetable/lib/week";

/**
 * 시간표 주간 이동(타임머신) 네비 — ijw TimetableHeader 이식.
 * ◀ / 이번주 / ▶ + 주차 라벨. 과거/미래 조회 중이면 배지로 명시(편집은 그 주에선 비활성).
 * searchParam(`?week=`) 링크 — 과목/뷰 토글과 동일 패턴(hrefForWeek가 그 둘을 보존).
 */
export function WeekNav({
  currentWeek,
  today,
  hrefForWeek,
}: {
  /** 보고 있는 주의 월요일(YYYY-MM-DD). */
  currentWeek: string;
  today: string;
  /** 월요일 → /timetable?... (view·subject 보존). */
  hrefForWeek: (monday: string) => string;
}) {
  const rel = weekRelation(currentWeek, today);
  const isCurrent = rel === "current";
  const iconBtn =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-full border p-1 transition";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">주</span>
      <div className="flex items-center gap-0.5">
        <ParamLink href={hrefForWeek(addWeeks(currentWeek, -1))} ariaLabel="이전 주" className={iconBtn}>
          <ChevronLeft size={13} strokeWidth={2.5} />
        </ParamLink>
        <ParamLink
          href={hrefForWeek(thisMonday(today))}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
            isCurrent
              ? "border-foreground bg-foreground text-background"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          이번주
        </ParamLink>
        <ParamLink href={hrefForWeek(addWeeks(currentWeek, 1))} ariaLabel="다음 주" className={iconBtn}>
          <ChevronRight size={13} strokeWidth={2.5} />
        </ParamLink>
      </div>
      <span className="text-text-dim num text-[11px] whitespace-nowrap">{weekLabel(currentWeek)}</span>
      {!isCurrent ? (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
            rel === "future" ? "bg-blue-soft text-blue" : "bg-amber-soft text-amber"
          }`}
        >
          {rel === "future" ? "미래 조회" : "과거 조회"}
        </span>
      ) : null}
    </div>
  );
}
