import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function ShuttleLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="shuttle">{children}</ModuleBoundary>;
}
