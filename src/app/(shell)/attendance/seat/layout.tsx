import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function SeatAttendanceLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="seat_attendance">{children}</ModuleBoundary>;
}
