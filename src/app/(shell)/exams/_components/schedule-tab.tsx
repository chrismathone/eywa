import { PeriodNav } from "@/components/period-nav";
import { monthLabel, shiftMonth } from "@/lib/date-kst";
import { KIND_LABEL, type UnifiedKind } from "@/features/grades/unified/model";
import { KIND_SOLID } from "@/features/grades/unified/kind-color";
import { ExamCalendar, type ExamDayItem } from "./exam-calendar";
import { Panel } from "./tab-parts";

type Href = (patch: Record<string, string>) => string;

/** 시험 일정 — 월 이동(PeriodNav, `?month=`) + 종류 범례 + 캘린더 탭과 같은 월 그리드. */
export function ScheduleTab({ month, today, items, dayHref, href }: {
  month: string; today: string; items: ExamDayItem[]; dayHref: Record<string, string>; href: Href;
}) {
  const thisMonth = today.slice(0, 7);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const kinds = [...new Set(items.map((item) => item.kind))] as UnifiedKind[];
  return <Panel title={<PeriodNav label={monthLabel(month)} prevHref={href({ tab: "schedule", month: shiftMonth(month, -1) })}
      nextHref={href({ tab: "schedule", month: shiftMonth(month, 1) })} currentHref={href({ tab: "schedule", month: thisMonth })}
      relation={month < thisMonth ? "past" : month > thisMonth ? "future" : "current"} />}
    sub={`시험 기록 ${total}건 · 칩을 누르면 그날 그 시험의 성적 현황이 열립니다.`}
    right={kinds.length ? <div className="flex flex-wrap items-center gap-3 text-sm">{kinds.map((kind) => <span key={kind} className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${KIND_SOLID[kind]}`} />{KIND_LABEL[kind]}</span>)}</div> : null}>
    <ExamCalendar month={month} today={today} items={items} dayHref={dayHref} />
  </Panel>;
}
