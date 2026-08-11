"use client";

// 병합 진입점 — **이미 있는 '같은 학생의 다른 등록상담' 목록 안**에 둔다.
// 새 메뉴를 만들지 않는 이유: 중복을 발견하는 자리가 곧 정리하는 자리여야 한다
// (그 안내문은 "중복이면 정리하고"라고만 하고 정리할 버튼이 없었다).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MergeDialog } from "./merge-dialog";

export function MergeButton({ ids, currentId }: { ids: string[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="두 상담을 한 건으로 합칩니다"
      >
        병합
      </Button>
      {open ? <MergeDialog ids={ids} currentId={currentId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
