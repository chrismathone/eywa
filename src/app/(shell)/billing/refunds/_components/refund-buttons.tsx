"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Printer, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { deleteRefundRequest } from "@/features/billing/server/refund-actions";

const REFUNDS_HREF = "/billing?tab=refunds";
const DELETE_FAILED = "삭제하지 못했습니다 — 연결을 확인하고 다시 눌러 주세요";

/** 환불 요청서 뷰 인쇄 — 플로팅 창(iframe) 안이라 이 문서만 A4(print-portrait)로 인쇄된다. */
export function PrintRefundButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="size-4" />
      인쇄
    </Button>
  );
}

/** `confirmText` = 확인 때 덧붙일 글(퇴원보고서에 이어진 요청서 — 지우면 원장 환불 결정 대기로 돌아감 · 리뷰 r2 B1). */
export function DeleteRefundButton({ id, name, confirmText }: { id: string; name: string; confirmText?: string }) {
  const inFrame = useInFrame();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      // 긴 확인 글 옆에서도 단추가 한 글자씩 꺾이지 않게 — 글은 줄어들고(min-w-0) 단추는 그대로(리뷰 r3 R3-m3).
      <span className="flex items-center gap-1.5 text-sm">
        <span className="text-text-dim shrink-0 whitespace-nowrap">{name || "이"} 요청서 삭제?</span>
        {confirmText ? <span role="note" className="text-danger min-w-0 text-xs">{confirmText}</span> : null}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // 액션 호출 자체가 실패(네트워크 등)해도 '처리 중'에 멈추지 않게 같은 실패 경로로 모은다.
            // (finally로 풀지 않는다 — 성공 뒤 이동하는 동안 버튼이 다시 열려 두 번 지우게 된다.)
            const res = await deleteRefundRequest(id).catch(() => ({ error: DELETE_FAILED }));
            if (res.error) {
              toast.error(res.error);
              setBusy(false);
              setConfirming(false);
              return;
            }
            // 성공 토스트는 없다 — 곧바로 풀 문서 이동이라 읽을 틈이 없다(학생 삭제와 같은 규약).
            // 🔴 `router.push`가 아니라 풀 문서 이동 — 서버 액션 직후의 push는 액션 응답이 이 페이지 트리를
            //    다시 적용하면서 삼켜진다(#102). 삼켜지면 창에 방금 지운 요청서의 404가 남는다.
            //    `replace`인 건 지운 요청서 주소가 죽은 칸이라서다(뒤로가기가 그 404에 걸리지 않게 — 학생 삭제와 같은 규약).
            window.location.replace(inFrame ? withEmbed(REFUNDS_HREF) : REFUNDS_HREF);
          }}
          className="text-danger shrink-0 font-bold whitespace-nowrap hover:underline"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "삭제"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-text-dim shrink-0 whitespace-nowrap hover:underline">
          취소
        </button>
      </span>
    );
  }
  return (
    <Button variant="outline" onClick={() => setConfirming(true)}>
      <Trash2 className="size-4" />
      삭제
    </Button>
  );
}
