import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delay={200}>
        {children}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </QueryProvider>
  );
}
