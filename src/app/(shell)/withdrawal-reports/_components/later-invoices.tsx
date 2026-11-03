"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { INVOICE_CATEGORY_LABEL } from "@/features/withdrawal-reports/prefill";
import { approveWithdrawalRefund } from "@/features/withdrawal-reports/server/refund-actions";
import type { LaterInvoice, LaterLine } from "@/features/withdrawal-reports/server/refund";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const control = "rounded-md border bg-background px-2 py-1.5 text-sm";
const refundable = (inv: LaterInvoice, l: LaterLine) => l.paidNet > 0 && inv.status !== "refunded" && !l.billingRefund && !l.refund;
function lineStatus(inv: LaterInvoice, l: LaterLine): string {
  if (inv.status === "refunded" || l.billingRefund) return "수납 환불 기록";
  const net = Math.max(0, l.amount - (l.discount ?? 0));
  return l.paidNet >= net && net > 0 ? "납부" : l.paidNet > 0 ? "일부 납부" : "미납";
}

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"이후에 납부한건 혹은 환불한 건에 대해서도 표시"*. 과목 수강종료는 끝내는 반 줄만.
 * 수납 청구 줄마다 토글 — *"어떤건을 환불할건지 토글토글토글해서 선택선택선택해 그 건을 환불하게"*. 고른 줄이 있을 때만
 * '환불 승인' → 데스크 담당자 고르기 + 확인("환불을 승인하시겠습니까?") → 요청서 한 장. 고른 게 없으면 담당자도 고르지 않는다
 * (*"환불건이 필요없으면… 굳이 데스크 담당자 선택하지 않아도"*). 다른 사람은 청구·요청서·담당·완료 여부만 본다.
 * 원장 2026-11-03: 환불은 **데스크 환불 단계**다 — 요청할 수 있는 사람 = 묶음의 관리자 · 요청자 · 관리자 승인을 생략한 보고서의 작성 강사 · 원장급
 * (`canRequestRefund` → `canApprove`). 처리 전 보고서(`gates`)는 데스크가 환불완료일자를 넣어야 퇴원·수강종료를 처리한다.
 */
export function LaterInvoices({ reportId, rows, canApprove, deskStaff, gates = false }: { reportId: string; rows: LaterInvoice[]; canApprove: boolean; deskStaff: { id: string; name: string }[]; gates?: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [desk, setDesk] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // 보고서 양식의 '환불 확인' 칸(원장 2026-10-30 *"퇴원보고서 내의 공간을 만들고 거기에 토글"*) — 청구가 없어도 칸은 있다.
  if (!rows.length) return <span className="text-muted-foreground">퇴원월 뒤 청구 없음 — 환불할 건이 없습니다.</span>;
  const lines = rows.flatMap(inv => inv.lines.map(line => ({ inv, line })));
  const chosen = lines.filter(x => picked.has(x.line.key) && refundable(x.inv, x.line));
  const total = chosen.reduce((s, x) => s + x.line.paidNet, 0);
  function toggle(key: string) {
    setError(""); setAsking(false);
    setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function approve() {
    setError("");
    startTransition(async () => {
      try {
        const result = await approveWithdrawalRefund(reportId, chosen.map(x => x.line.key), desk);
        if ("error" in result) { setError(result.error); return; }
        setAsking(false); setPicked(new Set()); setDesk("");
        toast.success(gates ? "환불을 승인했습니다. 데스크 담당자의 할 일로 보냈고, 환불 처리가 끝나면 퇴원·수강종료를 처리합니다." : "환불을 승인했습니다. 환불 요청서를 만들고 데스크 담당자의 할 일로 보냈습니다.");
        router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  const label = (inv: LaterInvoice, l: LaterLine) => `${inv.period} ${INVOICE_CATEGORY_LABEL[inv.category] ?? "기타"} · ${l.description.trim()}`;
  return <div className="space-y-2" aria-label="환불 확인">
    <div><p className="text-xs text-muted-foreground">퇴원월 다음 달부터 잡힌 수납 청구입니다{rows.some(r => r.partial) ? "(과목 수강종료라 끝내는 과목 몫과 기타 항목만)" : ""}. {canApprove ? `환불할 건만 토글로 고른 뒤 환불 승인을 누르세요. 고르지 않으면 아무것도 하지 않습니다.${gates ? " 환불을 승인하면 데스크 환불 처리까지 끝나야 퇴원·수강종료를 처리합니다." : ""}` : "환불 승인은 이 보고서의 관리자·요청자(관리자 승인을 생략한 보고서는 작성 강사)·원장이 할 수 있습니다."}</p></div>
    <table className="w-full text-xs">
      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">청구</th><th className="font-normal">청구액</th><th className="font-normal">납부</th><th className="font-normal">상태</th><th className="font-normal">환불요청</th></tr></thead>
      <tbody>{lines.map(({ inv, line }) => {
        const on = picked.has(line.key);
        return <tr key={line.key} className="border-b last:border-0">
          <td className="py-2">{label(inv, line)}{line.unbound && <span className="text-muted-foreground ml-1 text-xs">· 기타 항목</span>}</td>
          <td>{won(line.amount)}{line.discount ? <span className="text-xs text-muted-foreground"> (할인 {won(line.discount)})</span> : null}</td>
          <td>{won(line.paidNet)}</td>
          <td>{lineStatus(inv, line)}</td>
          <td>{line.refund
            ? <WindowLink href={`/billing/refunds/${line.refund.documentId}`} title="환불 요청서" className="text-primary hover:underline">{line.refund.completed ? "환불 완료" : "데스크 환불 대기"}{line.refund.deskName ? ` · 담당 ${line.refund.deskName}` : ""} · 요청서</WindowLink>
            : !refundable(inv, line) ? <span className="text-muted-foreground">—</span>
            : canApprove
              ? <button type="button" role="switch" aria-checked={on} aria-label={`${label(inv, line)} 환불`} disabled={pending} onClick={() => toggle(line.key)}
                  className="inline-flex items-center gap-2 text-sm disabled:opacity-50 print:hidden"><span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${on ? "left-4" : "left-0.5"}`} /></span>{on ? "환불" : "안 함"}</button>
              : <span className="text-muted-foreground">요청서 없음</span>}</td>
        </tr>;
      })}</tbody>
    </table>
    {canApprove && chosen.length > 0 && !asking && <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">선택 {chosen.length}건 · 환불 {won(total)}</span>
      <Button disabled={pending} onClick={() => { setError(""); setDesk(""); setAsking(true); }}>환불 승인</Button>
    </div>}
    {asking && chosen.length > 0 && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 승인 확인">
      <p className="text-sm">환불을 승인하시겠습니까? 고른 {chosen.length}건 · {won(total)}에 대한 환불 요청서가 만들어지고, 고른 데스크 담당자의 할 일·알림으로 갑니다.{gates ? " 데스크가 환불을 처리(환불완료일자 입력)해야 퇴원·수강종료를 처리합니다." : ""}</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{chosen.map(x => <li key={x.line.key}>{label(x.inv, x.line)} {won(x.line.paidNet)}</li>)}</ul>
      <label className="flex flex-wrap items-center gap-2 text-sm">데스크 담당자
        <select className={control} aria-label="데스크 담당자" value={desk} disabled={pending} onChange={e => setDesk(e.target.value)}>
          <option value="">고르기</option>
          {deskStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2"><Button disabled={pending || !desk} onClick={approve}>{pending ? "처리 중…" : "환불 승인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(false)}>닫기</Button></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </div>;
}
