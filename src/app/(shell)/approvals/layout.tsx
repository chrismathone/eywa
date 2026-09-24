import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="approvals">{children}</ModuleBoundary>;
}
