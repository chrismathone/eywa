"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CollapseSourceProvider } from "@/app/(shell)/attendance/_components/collapse-source";
import { saveSeatMonthlyCollapsed } from "@/features/attendance/seat/server/monthly-prefs";

export function SeatMonthlyCollapse({
  classIds,
  initial,
  children,
}: {
  classIds: string[];
  initial: string[];
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => new Set(initial));
  const value = useMemo(
    () => ({
      collapsed,
      toggleCollapsed: (id: string) => {
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          void saveSeatMonthlyCollapsed([...next]);
          return next;
        });
      },
      setAllCollapsed: (collapse: boolean) => {
        const next = collapse ? new Set(classIds) : new Set<string>();
        setCollapsed(next);
        void saveSeatMonthlyCollapsed([...next]);
      },
    }),
    [collapsed, classIds],
  );
  return <CollapseSourceProvider value={value}>{children}</CollapseSourceProvider>;
}
