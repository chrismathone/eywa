import type { SeatStatus } from "@/features/attendance/seat/server/actions";

export const SEAT_TONE: Record<SeatStatus, string> = {
  present: "bg-att-present text-att-present-ink border-transparent",
  absent: "bg-att-absent text-att-absent-ink border-transparent",
  late: "bg-att-late text-att-late-ink border-transparent",
};

export const SEAT_LABEL: Record<SeatStatus, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
};
