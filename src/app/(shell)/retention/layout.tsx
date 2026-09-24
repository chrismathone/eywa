import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function RetentionLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="retention">{children}</ModuleBoundary>;
}
