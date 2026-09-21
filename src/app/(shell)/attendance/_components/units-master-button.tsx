"use client";

import { PrintWindowButton } from "@/components/workspace/print-window";

export function UnitsMasterButton({ month }: { month: string }) {
  return <div className="flex shrink-0 justify-end">
    <PrintWindowButton id={`attendance/units-master/${month}`} href={`/attendance/units-master?month=${month}`}
      title={`영어 시수 마스터 · ${month}`} className="h-7 bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90" variant="default">
      시수 마스터
    </PrintWindowButton>
  </div>;
}
