import Link from "next/link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { BADGE_BASE, BADGE_TONE, cellDisplay, rollupDay, type SlotMark } from "@/features/attendance/cell-display";
import { BADGE_LABEL, badgeTitle } from "@/features/attendance/enrollment-span";
import { ratePercent } from "@/features/attendance/grid/totals";
import { SEAT_NAME, type SeatKey } from "@/features/attendance/seat/seat";
import type { SeatMonthCell, SeatMonthStudent } from "@/features/attendance/seat/monthly-build";
import type { SeatMonthDay } from "@/features/attendance/seat/monthly";

/** 출석률 신호등 — 월별 출석부(live-totals.tsx `rateColorOf`)와 **같은 문턱·같은 색**(90/80). */
function rateColor(rate: number | null): string {
  if (rate === null) return "text-text-faint";
  return rate >= 90 ? "text-green" : rate >= 80 ? "text-amber" : "text-danger";
}

export function MonthlyRow({
  seat,
  className,
  student,
  days,
  cells,
  holidays,
}: {
  seat: SeatKey;
  /** 이 반 이름 — 반이동 표식 툴팁("A반 → B반")에 쓴다. */
  className: string;
  student: SeatMonthStudent;
  days: SeatMonthDay[];
  cells: Record<string, SeatMonthCell>;
  holidays: Record<string, string>;
}) {
  const rate = ratePercent(student.counted);
  return (
    <tr className="hover:bg-bg-soft/40">
      <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
        {/* 반별 출석부와 같은 표식·같은 규약 — 회색 띠(소속 아님)만으로는 신입인지 퇴원인지 모른다.
            라벨은 우측 정렬(ml-auto), 자리가 부족하면 이름이 줄임표로 양보한다. */}
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate text-[12px] leading-tight font-bold" title={student.name}>
            {student.name}
          </span>
          {student.badges.map((b) => (
            <span
              key={`${b.kind}-${b.date}`}
              title={badgeTitle(b, className)}
              className={`${BADGE_BASE} ${BADGE_TONE[b.kind]} ml-auto`}
            >
              {BADGE_LABEL[b.kind]}
            </span>
          ))}
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
      title={review ? `${SEAT_NAME[seat]} 출석부로 찍힌 기록이 아닙니다` : holiday}
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
