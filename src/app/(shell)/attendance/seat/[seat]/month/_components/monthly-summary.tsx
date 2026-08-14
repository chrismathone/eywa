import { formatSessionUnits } from "@/features/attendance/session-units";
import type { SeatMonthSummary } from "@/features/attendance/seat/monthly-build";

/** 한눈에 줄 — 확정/확인을 한 숫자로 합치지 않는다. */
export function MonthlySummary({
  summary,
  minutesPerSlot,
}: {
  summary: SeatMonthSummary;
  minutesPerSlot: number | null;
}) {
  const min = minutesPerSlot;
  const confirmedMin =
    min != null ? ` (${min}분 × ${formatSessionUnits(summary.confirmedUnits)})` : "";
  return (
    <p className="text-foreground text-[13px] leading-snug break-keep">
      예정 <span className="num font-bold">{summary.classCount}</span>반 ·{" "}
      <span className="num font-bold">{summary.studentCount}</span>명
      <span className="text-text-faint mx-1.5">│</span>
      확정 <span className="num font-bold">{formatSessionUnits(summary.confirmedUnits)}</span>시수
      {confirmedMin}
      <span className="text-text-faint mx-1.5">│</span>
      확인 필요 <span className="text-amber num font-bold">{formatSessionUnits(summary.reviewUnits)}</span>시수
      <span className="text-text-faint mx-1.5">│</span>
      출석 <span className="num font-bold">{summary.present}</span> · 결석{" "}
      <span className="num font-bold">{summary.absent}</span> · 미입력{" "}
      <span className="num font-bold">{summary.unmarked}</span>
    </p>
  );
}

export function MonthlyLegend() {
  return (
    <p className="text-text-dim flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span>
        <i className="bg-att-present mr-1 inline-block size-2.5 rounded-sm align-middle" />
        출석
      </span>
      <span>
        <i className="bg-att-absent mr-1 inline-block size-2.5 rounded-sm align-middle" />
        결석
      </span>
      <span>
        <i className="bg-att-late mr-1 inline-block size-2.5 rounded-sm align-middle" />
        지각
      </span>
      <span>
        <i className="mr-1 inline-block size-2.5 rounded-sm align-middle ring-1 ring-inset ring-amber" />
        확인 필요
      </span>
    </p>
  );
}
