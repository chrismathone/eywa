"use client";

import { Printer, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// embedded=true(플로팅 창 안)면 window.close()가 무효라 닫기 버튼을 숨긴다(창 X로 닫음).
export function PrintActions({ embedded }: { embedded?: boolean }) {
  const router = useRouter();
  // 닫기: window.open으로 열린 독립 창이면 window.close()가 닫고, 미니멀 셸 드릴인(같은 탭 네비)이면
  // window.close()가 무효라 히스토리가 있으면 뒤로 이동(강사 셸에서 PDF 후 원스크린 복귀).
  const onClose = () => {
    if (window.history.length > 1) router.back();
    else window.close();
  };
  return (
    <div className="sticky top-4 z-10 -mt-2 mb-8 flex justify-end gap-2 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
      {embedded ? null : (
        <Button variant="secondary" onClick={onClose}>
          <X className="size-4" /> 닫기
        </Button>
      )}
    </div>
  );
}
