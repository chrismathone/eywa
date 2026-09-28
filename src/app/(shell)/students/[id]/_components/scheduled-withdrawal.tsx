"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cancelScheduledWithdrawal, type ChangeStatusState } from "@/features/students/server/actions";

/**
 * **퇴원 예약 취소** 버튼 — 미래 퇴원일로 저장된 예약(원장 2026-09-28 *"퇴원당일전까지 '재원'"*)을 푼다.
 * 예약 표시(`퇴원 예정 …`)는 서버 페이지가 상태 배지 옆에 그린다. 권한 게이트는 서버 액션이 다시 본다.
 */
export function CancelScheduledWithdrawal({ studentId, date }: { studentId: string; date: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ChangeStatusState, FormData>(cancelScheduledWithdrawal, undefined);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`${date} 퇴원 예약을 취소할까요? 재원 상태는 그대로입니다.`)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="id" value={studentId} />
      <input type="hidden" name="date" value={date} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "취소 중…" : "퇴원 예약 취소"}
      </Button>
      {state?.error ? <span className="text-danger text-sm">{state.error}</span> : null}
    </form>
  );
}
