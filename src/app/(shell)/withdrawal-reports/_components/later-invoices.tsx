"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { INVOICE_CATEGORY_LABEL } from "@/features/withdrawal-reports/prefill";
import { approveWithdrawalRefund } from "@/features/withdrawal-reports/server/refund-actions";
import type { LaterInvoice } from "@/features/withdrawal-reports/server/refund";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const STATUS_LABEL: Record<string, string> = { paid: "납부", partial: "일부 납부", pending: "미납", overdue: "미납", refunded: "환불됨" };

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"이후에 납부한건 혹은 환불한 건에 대해서도 표시"*.
 * 원장(`canApprove`)은 낸 돈이 있는 청구마다 '환불 승인' 토글 → 확인("환불을 승인하시겠습니까?") → 환불 요청서가 바로 만들어진다.
 * 다른 관리자는 청구와 요청서 여부만 본다.
 */
export function LaterInvoices({ reportId, rows, canApprove }: { reportId: string; rows: LaterInvoice[]; canApprove: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<LaterInvoice | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!rows.length) return null;
  function approve(row: LaterInvoice) {
    setError("");
    startTransition(async () => {
      try {
        const result = await approveWithdrawalRefund(reportId, row.id);
        if ("error" in result) { setError(result.error); return; }
        setAsking(null);
        toast.success(result.already ? "이미 승인된 청구입니다. 만든 환불 요청서를 그대로 씁니다." : "환불을 승인하고 환불 요청서를 만들었습니다. 수납 담당에게 알렸습니다.");
        router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  return <section className="space-y-3 rounded-xl border p-5" aria-label="퇴원 뒤 청구">
    <div><h2 className="text-sm font-semibold">퇴원 뒤 청구</h2><p className="mt-1 text-xs text-muted-foreground">퇴원월 다음 달부터 잡힌 청구입니다. {canApprove ? "낸 돈이 있는 청구는 환불을 승인하면 환불 요청서가 바로 만들어집니다." : "환불 승인은 원장만 할 수 있습니다."}</p></div>
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">청구</th><th className="font-normal">청구액</th><th className="font-normal">납부</th><th className="font-normal">상태</th><th className="font-normal">환불</th></tr></thead>
      <tbody>{rows.map(row => {
        const refundable = row.amountPaid > 0 && row.status !== "refunded";
        return <tr key={row.id} className="border-b last:border-0">
          <td className="py-2">{row.period} {INVOICE_CATEGORY_LABEL[row.category] ?? "기타"}</td>
          <td>{won(Math.max(0, row.amountTotal - row.amountDiscount))}</td>
          <td>{won(row.amountPaid)}</td>
          <td>{STATUS_LABEL[row.status] ?? "확인 필요"}</td>
          <td>{row.refundDocId
            ? <WindowLink href={`/billing/refunds/${row.refundDocId}`} title="환불 요청서" className="text-primary hover:underline">환불 승인됨 · 요청서 보기</WindowLink>
            : !refundable ? <span className="text-muted-foreground">—</span>
            : canApprove
              ? <button type="button" role="switch" aria-checked={false} aria-label={`${row.period} 환불 승인`} disabled={pending} onClick={() => { setError(""); setAsking(row); }}
                  className="inline-flex items-center gap-2 text-sm disabled:opacity-50"><span className="relative inline-block h-5 w-9 rounded-full bg-muted-foreground/30"><span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow" /></span>환불 승인</button>
              : <span className="text-muted-foreground">요청서 없음</span>}</td>
        </tr>;
      })}</tbody>
    </table>
    {asking && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 승인 확인">
      <p className="text-sm">환불을 승인하시겠습니까? {asking.period} {INVOICE_CATEGORY_LABEL[asking.category] ?? "기타"} 낸 금액 {won(asking.amountPaid)}에 대한 환불 요청서가 원장 승인으로 만들어지고, 수납 담당에게 알림이 갑니다.</p>
      <div className="flex gap-2"><Button disabled={pending} onClick={() => approve(asking)}>{pending ? "처리 중…" : "환불 승인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(null)}>닫기</Button></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </section>;
}
