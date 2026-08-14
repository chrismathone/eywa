import Link from "next/link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { cellDisplay, rollupDay, type SlotMark } from "@/features/attendance/cell-display";
import { ratePercent } from "@/features/attendance/grid/totals";
import type { SeatKey } from "@/features/attendance/seat/seat";
import type { SeatMonthCell, SeatMonthStudent } from "@/features/attendance/seat/monthly-build";
import type { SeatMonthDay } from "@/features/attendance/seat/monthly";

function rateColor(rate: number | null): string {
  if (rate === null) return "text-text-faint";
  return rate >= 90 ? "text-primary" : rate >= 80 ? "text-amber" : "text-danger";
}

export function MonthlyRow({
  seat,
  student,
  days,
  cells,
  holidays,
}: {
  seat: SeatKey;
  student: SeatMonthStudent;
  days: SeatMonthDay[];
  cells: Record<string, SeatMonthCell>;
  holidays: Record<string, string>;
}) {
  const rate = ratePercent(student.counted);
  return (
    <tr className="hover:bg-bg-soft/40">
      <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
        <span className="truncate text-[12px] leading-tight font-bold" title={student.name}>
          {student.name}
        </span>
      </td>
      <td className="border-line text-text-dim truncate border-b border-r px-1.5 py-1 text-[11px]">
        {schoolGradeLabel(student.school, student.grade)}
      </td>
      {days.map((d) => {
        if (d.placeholder) {
          return <td key={d.date} className="border-line border-b border-r" aria-hidden />;
        }
        const cell = cells[d.date];
        return (
          <MonthCell
            key={d.date}
            seat={seat}
            date={d.date}
            cell={cell}
            holiday={holidays[d.date]}
            weekend={d.isWeekend}
          />
        );
      })}
      <td className="border-line text-foreground num sticky right-[104px] z-10 w-[44px] min-w-[44px] border-b border-l bg-card px-1 py-2 text-right text-[12px]">
        {student.confirmedUnits > 0 ? formatSessionUnits(student.confirmedUnits) : "—"}
      </td>
      <td className="border-line text-amber num sticky right-[64px] z-10 w-[40px] min-w-[40px] border-b bg-card px-1 py-2 text-right text-[12px]">
        {student.reviewUnits > 0 ? formatSessionUnits(student.reviewUnits) : "—"}
      </td>
      <td className={`border-line num sticky right-0 z-10 w-[64px] min-w-[64px] border-b bg-card px-2 py-2 text-right text-[12px] font-bold ${rateColor(rate)}`}>
        {rate === null ? "—" : `${rate}%`}
      </td>
    </tr>
  );
}

function MonthCell({
  seat,
  date,
  cell,
  holiday,
  weekend,
}: {
  seat: SeatKey;
  date: string;
  cell: SeatMonthCell | undefined;
  holiday?: string;
  weekend: boolean;
}) {
  const slots = cell?.slots ?? [];
  const recorded: SlotMark[] = slots
    .filter((s) => s.status)
    .map((s) => ({ slot: s.start, status: s.status!, units: s.units }));
  const day = rollupDay(recorded);
  const disp = cellDisplay(day?.status ?? recorded[0]?.status ?? null, day?.units ?? recorded[0]?.units, {
    attendDay: cell?.expected,
    muted: weekend || !!holiday,
    outside: cell?.outside,
    day,
  });
  const review = slots.some((s) => s.track === "review");
  const start = slots.find((s) => s.status)?.start ?? slots[0]?.start;
  const href = start
    ? `/attendance/seat/${seat}?date=${date}&start=${start}`
    : `/attendance/seat/${seat}?date=${date}`;
  const clickable = Boolean(cell?.expected || recorded.length);
  const inner = (
    <span
      className={`flex h-7 items-center justify-center text-[11px] ${disp.className} ${review ? "ring-1 ring-inset ring-amber" : ""}`}
      style={disp.style}
    >
      {disp.text}
    </span>
  );
  return (
    <td
      className="border-line border-b border-r p-0 text-center"
      title={review ? "자리 표시가 없어 아직 담임 정산에 남아 있는 기록입니다" : holiday}
    >
      {clickable ? (
        <Link href={href} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </td>
  );
}
