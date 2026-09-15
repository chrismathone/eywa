import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HoverTipLayer } from "@/components/hover-tip/hover-tip-layer";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delay={200}>
        {children}
        <Toaster richColors position="top-right" />
        {/* 메모·사유 툴팁(카드) — 문서마다 한 장. 칸은 `data-tip` 한 줄만 달고 여기서 그린다(원장 2026-09-15). */}
        <HoverTipLayer />
      </TooltipProvider>
    </QueryProvider>
  );
}
