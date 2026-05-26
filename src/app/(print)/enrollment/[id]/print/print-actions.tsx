"use client";

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintActions() {
  return (
    <div className="sticky top-4 z-10 -mt-2 mb-8 flex justify-end gap-2 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
      <Button variant="secondary" onClick={() => window.close()}>
        <X className="size-4" /> 닫기
      </Button>
    </div>
  );
}
