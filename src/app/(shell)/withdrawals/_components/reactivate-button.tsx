"use client";

import { useTransition } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reactivateStudent } from "@/features/withdrawals/server/actions";

export function ReactivateButton({ studentId }: { studentId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("이 학생을 재원 상태로 되돌립니다. 퇴원 사유와 상담 기록이 사라집니다. 진행할까요?")) return;
    const fd = new FormData();
    fd.append("studentId", studentId);
    startTransition(async () => {
      await reactivateStudent(undefined, fd);
    });
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleClick}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      재원 복구
    </Button>
  );
}
