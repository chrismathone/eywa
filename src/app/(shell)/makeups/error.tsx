"use client";

import { Button } from "@/components/ui/button";
export default function MakeupError({ reset }: { reset: () => void }) {
  return <div className="space-y-3 p-4"><p role="alert">보강 화면을 불러오지 못했습니다. 입력·조회 상태를 확인한 뒤 다시 시도해 주세요.</p>
    <Button variant="outline" onClick={reset}>다시 불러오기</Button>
  </div>;
}
