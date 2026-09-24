import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function McsLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="mcs">{children}</ModuleBoundary>;
}
