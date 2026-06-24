"use client";

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// embedded=true(플로팅 창 안)면 window.close()가 무효라 닫기 버튼을 숨긴다(창 X로 닫음).
export function PrintActions({ embedded }: { embedded?: boolean }) {
  return (
    <div className="sticky top-4 z-10 -mt-2 mb-8 flex justify-end gap-2 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
      {embedded ? null : (
        <Button variant="secondary" onClick={() => window.close()}>
          <X className="size-4" /> 닫기
        </Button>
      )}
    </div>
  );
}
