"use client";

import { Button } from "@/components/ui/button";

export default function IntakeCareError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-6 text-sm" role="alert">
      <p>약속 관리 정보를 불러오지 못했습니다. 배정과 접근 권한 또는 기능 준비 상태를 확인해 주세요.</p>
      <Button variant="outline" onClick={reset}>다시 불러오기</Button>
    </div>
  );
}
