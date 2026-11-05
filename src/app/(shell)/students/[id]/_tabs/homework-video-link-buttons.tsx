"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { revokeVideoSubmitLinks } from "@/features/video-submit/server/actions";

/**
 * 반 한 줄의 '링크 끊기' — 이미 나간 제출 링크(그 학생 × 반의 살아 있는 링크 전부)를 닫는다.
 * 🔴 '제출 링크 복사'는 거뒀다(원장 2026-10-03 *"학생영상 개별링크는 더이상 생성하지않고"*) — 학생은 올리기 사이트(`/v`)나 ClassNote로 올린다.
 * canRevoke = 서버 게이트와 같은 판정(`canWriteTenant(role, "students")`). 거짓이면 '쓰는 중 n개'만 보이고 단추는 그리지 않는다.
 */
export function HomeworkVideoLinkButtons(props: { studentId: string; classId: string; classLabel: string; count: number; until: string | null; canRevoke: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // 끊은 뒤엔 새로 그리지 않는다 — 다시 그리면 끊을 링크가 없는 반의 줄이 빠지면서 결과 문구도 함께 사라진다(리뷰 2026-10-03).
  const [done, setDone] = useState(false);

  function revoke() {
    if (!window.confirm(`${props.classLabel} 제출 링크를 모두 끊을까요? 이미 보낸 링크로는 더 이상 올릴 수 없습니다.`)) return;
    startTransition(async () => {
      const result = await revokeVideoSubmitLinks(props.studentId, props.classId);
      setMessage(!result.ok ? result.error : result.revoked ? `링크 ${result.revoked}개를 끊었습니다.` : "끊을 링크가 없습니다(이미 끝났거나 끊겼습니다).");
      if (result.ok) setDone(true);
      else router.refresh();
    });
  }

  return (
    <>
      {/* 끊은 뒤엔 '쓰는 중'을 지운다 — 결과 문구와 어긋나지 않게(새로 그리지 않으므로 여기서 바꾼다). */}
      {done ? null : <span className="text-text-dim text-sm"><SheetText value={`쓰는 중 ${props.count}개 · ${props.until ?? ""}까지`} /></span>}
      <div className="flex basis-full flex-col items-end gap-1 sm:basis-auto">
        {done || !props.canRevoke ? null : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={revoke}><SheetText value={"링크 끊기"} /></Button>}
        {message ? <p className="text-text-dim text-xs break-keep" aria-live="polite">{message}</p> : null}
      </div>
    </>
  );
}
