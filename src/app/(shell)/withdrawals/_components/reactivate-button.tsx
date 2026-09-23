"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { reactivateStudent } from "@/features/withdrawals/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

export function ReactivateButton({ studentId }: { studentId: string }) {
  const [isPending, startTransition] = useTransition();
  const embed = useEmbed();

  function handleClick() {
    if (!confirm("이 학생을 재원 상태로 되돌립니다. 퇴원 사유와 상담 기록이 사라집니다. 진행할까요?")) return;
    const fd = new FormData();
    fd.append("studentId", studentId);
    startTransition(async () => {
      const res = await reactivateStudent(undefined, fd);
      // 실패(권한 없음 포함)를 삼키면 눌러도 무반응으로 보인다(감사 E9) — 사유를 띄운다.
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      // 재원 복구는 퇴원으로 닫힌 수강을 다시 연다 — 회차 확정의 예정 시수가 바뀐다.
      notifyTermPlansChanged();
      toast.success("재원으로 복구했습니다");
      // 이 학생은 더는 퇴원생이 아니다 — 퇴원 상세에 남겨 두면 복구가 안 된 것처럼 보인다 → 목록으로.
      // 서버 액션 직후의 router.push는 삼켜진다([[#102]]) — 문서 이동 + 창 안이면 embed 유지([[#133]]).
      window.location.assign(embed ? withEmbed("/withdrawals") : "/withdrawals");
    });
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleClick}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      재원 복구
    </Button>
  );
}
