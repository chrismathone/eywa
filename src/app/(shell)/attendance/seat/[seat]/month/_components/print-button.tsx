"use client";

import { PrintWindowButton } from "@/components/workspace/print-window";
import type { SeatKey } from "@/features/attendance/seat/seat";

export function MonthlyPrintButton({ seat, month, title }: { seat: SeatKey; month: string; title: string }) {
  return (
    <PrintWindowButton
      id={`print/seat-month/${seat}/${month}`}
      href={`/attendance/seat/${seat}/month/print?month=${month}`}
      title={title}
      variant="outline"
      className="h-7 rounded-full px-2.5 text-xs"
    >
      인쇄
    </PrintWindowButton>
  );
}
