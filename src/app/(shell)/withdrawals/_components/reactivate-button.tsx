"use client";

import { useTransition } from "react";
import { Loader2, UserPlus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { reactivateStudent } from "@/features/withdrawals/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

export function ReactivateButton({ studentId }: { studentId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("이 학생을 재원 상태로 되돌립니다. 퇴원 사유와 상담 기록이 사라집니다. 진행할까요?")) return;
    const fd = new FormData();
    fd.append("studentId", studentId);
    startTransition(async () => {
      const res = await reactivateStudent(undefined, fd);
      // 재원 복구는 퇴원으로 닫힌 수강을 다시 연다 — 회차 확정의 예정 시수가 바뀐다.
      if (!res?.error) notifyTermPlansChanged();
    });
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleClick}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      재원 복구
    </Button>
  );
}
