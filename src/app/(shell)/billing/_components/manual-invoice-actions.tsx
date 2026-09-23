"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { markManualInvoicePaid, voidManualInvoice } from "@/features/billing/server/manual-invoice-actions";

/**
 * 수동 청구서 줄의 '완납'·'취소'(감사 N15) — aywa에서 직접 만든 청구서에만 선다(판정은 부모가 `isManualInvoiceShape`로,
 * 서버가 저장된 원본으로 다시 본다). 돈이 걸린 되돌리기 어려운 동작이라 누르기 전에 한 번 묻는다.
 */
export function ManualInvoiceActions({
  invoiceId,
  status,
  label,
}: {
  invoiceId: string;
  status: string;
  /** 확인 창 문구용 — "홍길동 2026-09". */
  label: string;
}) {
  const [pending, start] = useTransition();
  const [method, setMethod] = useState("");
  const canPay = status === "unpaid" || status === "partial";
  const canVoid = status === "unpaid";
  if (!canPay && !canVoid) return null;

  const run = (kind: "paid" | "void") => {
    const msg =
      kind === "paid"
        ? `${label} 청구서를 완납 처리할까요?\n실청구(청구 − 할인) 전액이 오늘 수납된 것으로 기록됩니다.`
        : `${label} 청구서를 취소할까요?\n미수·수납률 집계에서 빠집니다(감사로그에 남습니다).`;
    if (!confirm(msg)) return;
    start(async () => {
      const res = kind === "paid" ? await markManualInvoicePaid(invoiceId, method || null) : await voidManualInvoice(invoiceId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      // 목록은 서버 액션의 revalidatePath가 다시 그린다.
      toast.success(kind === "paid" ? "완납 처리했습니다" : "청구서를 취소했습니다");
    });
  };

  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      {canPay ? (
        <>
          <select
            aria-label="결제수단"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            disabled={pending}
            className="border-line text-text-dim rounded border bg-transparent px-1 py-0.5 text-xs"
          >
            <option value="">결제수단</option>
            <option value="card">카드</option>
            <option value="transfer">계좌이체</option>
            <option value="cash">현금</option>
            <option value="other">기타</option>
          </select>
          <button type="button" disabled={pending} onClick={() => run("paid")} className="text-primary font-medium hover:underline disabled:opacity-50">
            완납
          </button>
        </>
      ) : null}
      {canVoid ? (
        <button type="button" disabled={pending} onClick={() => run("void")} className="text-danger font-medium hover:underline disabled:opacity-50">
          취소
        </button>
      ) : null}
    </span>
  );
}
