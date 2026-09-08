import { formatSessionUnits } from "@/features/attendance/session-units";
import { DAY_TONE, HEAD_ROW_H } from "@/features/attendance/cell-display";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ClassGroupBody, CollapseAllButton } from "@/app/(shell)/attendance/_components/class-group";
import type { SeatKey } from "@/features/attendance/seat/seat";
import type { SeatMonthlyView } from "@/features/attendance/seat/monthly-build";
import { MonthlyRow } from "./monthly-row";

const HEAD_UNDERLINE =
  "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line after:content-['']";
const EDGE_RIGHT = "before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-line before:content-['']";
const EDGE_LEFT = "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line before:content-['']";
const COL = { name: 104, school: 84, confirmed: 44, review: 40, rate: 64, day: 30 } as const;

export function MonthlyTable({
  seat,
  view,
  holidays,
}: {
  seat: SeatKey;
  view: SeatMonthlyView;
  holidays: Record<string, string>;
}) {
  const days = view.days;
  const classDows = new Set(view.groups.flatMap((g) => g.students.flatMap((s) => s.attendDows)));
  const colSpan = days.length + 5;
  const minWidth = COL.name + COL.school + days.length * COL.day + COL.confirmed + COL.review + COL.rate;

  return (
    <DragScrollArea scrollY className="bg-card shadow-card h-full rounded-2xl">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth }}>
        <colgroup>
          <col style={{ width: COL.name }} />
          <col style={{ width: COL.school }} />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          <col style={{ width: COL.confirmed }} />
          <col style={{ width: COL.review }} />
          <col style={{ width: COL.rate }} />
        </colgroup>
        <thead>
          <tr className={HEAD_ROW_H}>
            <th className={`bg-bg-soft sticky top-0 left-0 z-[60] ${HEAD_UNDERLINE} ${EDGE_RIGHT} px-2 py-1 text-center`}>
              <CollapseAllButton classIds={view.groups.map((g) => g.classId)} />
              <span className="micro">이름</span>
            </th>
            <th className={`bg-bg-soft border-line sticky top-0 z-50 ${HEAD_UNDERLINE} border-r px-1.5 py-1 text-center`}>
              <span className="micro">학교·학년</span>
            </th>
            {days.map((d) => {
              if (d.placeholder) {
                return <th key={d.date} className={`bg-bg-soft sticky top-0 z-50 ${HEAD_UNDERLINE} min-w-[30px]`} aria-hidden />;
              }
              const holiday = holidays[d.date];
              const isClassDay = classDows.has(d.dow) && !holiday;
              const bg = d.isToday ? "bg-primary" : isClassDay ? DAY_TONE.classDay : d.isWeekend || holiday ? DAY_TONE.weekend : "bg-card";
              const fg = d.isToday ? "text-primary-foreground" : holiday || d.dow === 0 ? "text-danger" : "text-foreground";
              return (
                <th key={d.date} title={holiday} className={`border-line num sticky top-0 z-50 ${HEAD_UNDERLINE} min-w-[30px] border-r px-0.5 py-1 text-center text-xs ${bg} ${fg}`}>
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
            <th className={`bg-bg-soft sticky top-0 right-[104px] z-[60] ${HEAD_UNDERLINE} ${EDGE_LEFT} px-1 py-2 text-center`}>
              <span className="micro">확정</span>
            </th>
            <th className={`bg-bg-soft sticky top-0 right-[64px] z-[60] ${HEAD_UNDERLINE} px-1 py-2 text-center`}>
              <span className="micro">확인</span>
            </th>
            <th className={`bg-bg-soft sticky top-0 right-0 z-[60] ${HEAD_UNDERLINE} px-2 py-2 text-center`}>
              <span className="micro">출석률</span>
            </th>
          </tr>
        </thead>
        {view.groups.map((g) => (
          <ClassGroupBody
            key={g.classId}
            classId={g.classId}
            colSpan={colSpan}
            summary={
              <>
                <span className="text-foreground text-xs font-bold">{g.className}</span>
                {g.scheduleLabel ? <span className="text-text-faint text-xs">{g.scheduleLabel}</span> : null}
                <span className="text-text-dim text-xs">{g.students.length}명</span>
                <span className="text-text-dim num text-xs">
                  확정 {formatSessionUnits(g.confirmedUnits)}시수
                  {view.minutesPerSlot != null ? ` (${view.minutesPerSlot}분 × ${formatSessionUnits(g.confirmedUnits)})` : ""}
                  {" / 확인 "}
                  {formatSessionUnits(g.reviewUnits)}
                </span>
              </>
            }
          >
            {g.students.map((s) => (
              <MonthlyRow key={s.id} seat={seat} className={g.className} student={s} days={days} cells={g.cells[s.id] ?? {}} holidays={holidays} />
            ))}
          </ClassGroupBody>
        ))}
        <tfoot>
          <tr className="bg-bg-soft">
            <td className="border-line sticky left-0 z-10 border-t px-2 py-1 text-xs font-bold" colSpan={2}>
              확정
            </td>
            {days.map((d) => (
              <td key={d.date} className="border-line num border-t px-0.5 py-1 text-center text-xs">
                {d.placeholder ? "" : view.dateTotals[d.date]?.confirmed ? formatSessionUnits(view.dateTotals[d.date]!.confirmed) : "·"}
              </td>
            ))}
            <td className="border-line num sticky right-[104px] z-10 border-t bg-bg-soft px-1 py-1 text-right text-xs font-bold">
              {formatSessionUnits(view.summary.confirmedUnits)}
            </td>
            <td className="border-line sticky right-[64px] z-10 border-t bg-bg-soft" />
            <td className="border-line sticky right-0 z-10 border-t bg-bg-soft" />
          </tr>
          <tr className="bg-bg-soft">
            <td className="border-line text-amber sticky left-0 z-10 border-t px-2 py-1 text-xs font-bold" colSpan={2}>
              확인
            </td>
            {days.map((d) => (
              <td key={`r-${d.date}`} className="border-line text-amber num border-t px-0.5 py-1 text-center text-xs">
                {d.placeholder ? "" : view.dateTotals[d.date]?.review ? formatSessionUnits(view.dateTotals[d.date]!.review) : "·"}
              </td>
            ))}
            <td className="border-line sticky right-[104px] z-10 border-t bg-bg-soft" />
            <td className="border-line text-amber num sticky right-[64px] z-10 border-t bg-bg-soft px-1 py-1 text-right text-xs font-bold">
              {formatSessionUnits(view.summary.reviewUnits)}
            </td>
            <td className="border-line sticky right-0 z-10 border-t bg-bg-soft" />
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
  );
}
