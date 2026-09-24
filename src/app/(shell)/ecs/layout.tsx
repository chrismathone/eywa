import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function EcsLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="ecs">{children}</ModuleBoundary>;
}
