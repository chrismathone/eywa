import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="calendar">{children}</ModuleBoundary>;
}
