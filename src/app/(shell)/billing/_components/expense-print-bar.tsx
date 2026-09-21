"use client";

import { Printer } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";

// 지출결의서 in-place 인쇄(이미 플로팅 창이라 window.print()가 창 문서만 인쇄 — 계산기 패턴).
// 닫기는 창 X로(이 표면은 항상 창) → 인쇄 버튼만. print:hidden.
export function ExpensePrintBar() {
  return (
    <div className="mx-auto mb-4 flex max-w-[760px] justify-end print:hidden">
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
    </div>
  );
}
