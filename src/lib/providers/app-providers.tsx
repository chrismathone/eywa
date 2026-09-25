import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HoverTipLayer } from "@/components/hover-tip/hover-tip-layer";
import { MutationSignalInstaller } from "@/components/workspace/mutation-signal-installer";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delay={200}>
        {children}
        <Toaster richColors position="top-right" />
        {/* 메모·사유 툴팁(카드) — 문서마다 한 장. 칸은 `data-tip` 한 줄만 달고 여기서 그린다(원장 2026-09-15). */}
        <HoverTipLayer />
        {/* 저장 성공 → "바뀜" 방송 — 숨어 있던 창이 다시 보일 때 새로고침할 근거(창 시스템, 2026-09-25). */}
        <MutationSignalInstaller />
      </TooltipProvider>
    </QueryProvider>
  );
}
