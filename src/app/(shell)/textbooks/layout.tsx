import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function TextbooksLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="textbooks">{children}</ModuleBoundary>;
}
