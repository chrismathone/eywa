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
const control = "rounded-md border bg-background px-2 py-1.5 text-sm";

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"이후에 납부한건 혹은 환불한 건에 대해서도 표시"*. 과목 수강종료는 끝내는 반 몫만.
 * 원장(`canApprove`)은 낸 돈이 있는 청구마다 '환불 승인' 토글 → 데스크 담당자 고르기 + 확인("환불을 승인하시겠습니까?") →
 * 환불 요청서가 바로 만들어지고 그 담당자의 '내 할 일'·알림으로 간다. 다른 관리자는 청구·요청서·담당·완료 여부만 본다.
 */
export function LaterInvoices({ reportId, rows, canApprove, deskStaff }: { reportId: string; rows: LaterInvoice[]; canApprove: boolean; deskStaff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState<LaterInvoice | null>(null);
  const [desk, setDesk] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!rows.length) return null;
  function approve(row: LaterInvoice) {
    setError("");
    startTransition(async () => {
      try {
        const result = await approveWithdrawalRefund(reportId, row.id, desk);
        if ("error" in result) { setError(result.error); return; }
        setAsking(null);
        toast.success(result.already ? "이미 승인된 청구입니다. 만든 환불 요청서를 그대로 씁니다." : "환불을 승인했습니다. 환불 요청서를 만들고 데스크 담당자의 할 일로 보냈습니다.");
        router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  const label = (row: LaterInvoice) => `${row.period} ${INVOICE_CATEGORY_LABEL[row.category] ?? "기타"}${row.partial ? `(${row.lines.map(l => l.description).join(", ")})` : ""}`;
  return <section className="space-y-3 rounded-xl border p-5" aria-label="퇴원 뒤 청구">
    <div><h2 className="text-sm font-semibold">퇴원 뒤 청구</h2><p className="mt-1 text-xs text-muted-foreground">퇴원월 다음 달부터 잡힌 청구입니다{rows.some(r => r.partial) ? "(과목 수강종료라 끝내는 반 몫만)" : ""}. {canApprove ? "낸 돈이 있는 청구는 환불을 승인하면 환불 요청서가 만들어지고 고른 데스크 담당자의 할 일로 갑니다." : "환불 승인은 원장만 할 수 있습니다."}</p></div>
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">청구</th><th className="font-normal">청구액</th><th className="font-normal">납부</th><th className="font-normal">상태</th><th className="font-normal">환불</th></tr></thead>
      <tbody>{rows.map(row => {
        const refundable = row.amountPaid > 0 && row.status !== "refunded";
        return <tr key={row.id} className="border-b last:border-0">
          <td className="py-2">{label(row)}</td>
          <td>{won(row.amountBilled)}</td>
          <td>{won(row.amountPaid)}</td>
          <td>{STATUS_LABEL[row.status] ?? "확인 필요"}</td>
          <td>{row.refund
            ? <WindowLink href={`/billing/refunds/${row.refund.documentId}`} title="환불 요청서" className="text-primary hover:underline">{row.refund.completed ? "환불 완료" : "환불 승인됨"}{row.refund.deskName ? ` · 담당 ${row.refund.deskName}` : ""} · 요청서</WindowLink>
            : !refundable ? <span className="text-muted-foreground">—</span>
            : canApprove
              ? <button type="button" role="switch" aria-checked={false} aria-label={`${row.period} 환불 승인`} disabled={pending} onClick={() => { setError(""); setDesk(""); setAsking(row); }}
                  className="inline-flex items-center gap-2 text-sm disabled:opacity-50"><span className="relative inline-block h-5 w-9 rounded-full bg-muted-foreground/30"><span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow" /></span>환불 승인</button>
              : <span className="text-muted-foreground">요청서 없음</span>}</td>
        </tr>;
      })}</tbody>
    </table>
    {asking && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 승인 확인">
      <p className="text-sm">환불을 승인하시겠습니까? {label(asking)} 낸 금액 {won(asking.amountPaid)}에 대한 환불 요청서가 원장 승인으로 만들어지고, 고른 데스크 담당자의 할 일·알림으로 갑니다.</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">데스크 담당자
        <select className={control} aria-label="데스크 담당자" value={desk} disabled={pending} onChange={e => setDesk(e.target.value)}>
          <option value="">고르기</option>
          {deskStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2"><Button disabled={pending || !desk} onClick={() => approve(asking)}>{pending ? "처리 중…" : "환불 승인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(null)}>닫기</Button></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </section>;
}
