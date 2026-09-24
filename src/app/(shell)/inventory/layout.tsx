import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="inventory">{children}</ModuleBoundary>;
}
