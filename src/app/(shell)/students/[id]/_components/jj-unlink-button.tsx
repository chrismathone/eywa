"use client";

/**
 * 인재원 학습 계정 짝 끊기(관리자). 권한·감사로그(끊은 계정 아이디 포함)는 서버 액션이 한다(link-actions.ts).
 * 끊은 계정을 토스트에 적는다 — 잘못 끊었으면 그 아이디로 바로 다시 이을 수 있게.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unlinkIjwStudent } from "@/features/ijw/server/link-actions";

export function JjUnlinkButton({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("이 학생과 인재원 학습 계정의 연결을 끊을까요?")) return;
        start(async () => {
          const res = await unlinkIjwStudent(studentId);
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(`인재원 계정 ${res.ijwId}와의 연결을 끊었습니다`);
            router.refresh();
          }
        });
      }}
    >
      연결 끊기
    </Button>
  );
}
