import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";

export default function ClassReviewLayout({ children }: { children: ReactNode }) {
  return <ModuleBoundary id="class_review">{children}</ModuleBoundary>;
}
