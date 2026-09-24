import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function KioskSettingsLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="kiosk">{children}</ModuleBoundary>;
}
