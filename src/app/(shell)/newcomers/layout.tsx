import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function NewcomersLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="newcomers">{children}</ModuleBoundary>;
}
