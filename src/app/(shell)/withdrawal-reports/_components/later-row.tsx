"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { INVOICE_CATEGORY_LABEL } from "@/features/withdrawal-reports/prefill";
import { approvable, lineRefundable as refundable, type OpenClaim } from "@/features/withdrawal-reports/refund-decision";
import type { LaterInvoice, LaterLine } from "@/features/withdrawal-reports/server/refund";
import { deductionText, increaseText, lineStatus, otherRefundText, paidText, separatedText, unallocNote, won, type LineDeductionView } from "./later-line-text";

export const laterLabel = (inv: LaterInvoice, l: LaterLine) => `${inv.period} ${INVOICE_CATEGORY_LABEL[inv.category] ?? "기타"} · ${l.description.trim()}`;

/** 한 줄의 결정 표시 — 고름 · 결정 표시('결정 전' 등) · 다시 정할 이 묶음 요청서 줄 · 뺄 몫 · 다시 승인하면 요청할 돈(낸 돈 − 뺄 몫). */
export type LaterRowView = { on: boolean; mark: string | null; re?: OpenClaim; deduction?: LineDeductionView; remain: number };

/**
 * 퇴원월 뒤 청구 한 줄(`LaterInvoices` — 한 파일 200줄). 토글 = 원장이 지금 정할 수 있고 환불 승인으로 고를 수 있으며 돌려줄 남은 돈이 있는 줄만.
 * 환불을 마친 이 묶음 요청서의 줄에 그 뒤 낸 돈이 늘면 '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'(원장 결정 2026-11-09 · 첫 환불 기록은 그대로).
 */
export function LaterRow({ inv, line, showReissue, view, canDecide, decisionOpen, pending, subjectLabel, onToggle, onSeparate }: {
  inv: LaterInvoice; line: LaterLine; showReissue: boolean; view: LaterRowView;
  /** 원장이 지금 정할 수 있나(원장급 · 결정 기록을 읽었음). */
  canDecide: boolean; decisionOpen: boolean; pending: boolean;
  subjectLabel: (k: string) => string; onToggle: (key: string) => void; onSeparate: (key: string) => void;
}) {
  const { on, mark, re, deduction, remain } = view;
  const note = unallocNote(line, subjectLabel);
  const label = laterLabel(inv, line);
  const pickable = canDecide && approvable(inv, line) && remain > 0;
  return <tr className="border-b last:border-0">
    <td className="py-2">{label}{line.unbound && <span className="text-muted-foreground ml-1 text-xs">· 기타 항목</span>}
      {note && <div className="text-muted-foreground mt-0.5 text-xs">{note}</div>}
      {showReissue && <div role="note" className="mt-0.5 text-xs text-destructive">같은 달 재발행 청구가 있습니다 — 낸 돈이 옮겨졌는지 수납에서 확인</div>}</td>
    {/* 미배분 납부 줄은 청구된 항목이 아니다 — 청구액 '—'(리뷰 r2 m11). 부분 환불 줄은 남은 낸 돈과 그 내역. 금액은 꺾지 않는다(리뷰 r3 R2-m13 4a). */}
    <td className="pr-2"><span className="whitespace-nowrap">{line.unallocated ? "—" : won(line.amount)}</span>{line.discount ? <span className="text-xs text-muted-foreground"> (할인 {won(line.discount)})</span> : null}</td>
    <td className="pr-2"><span className="whitespace-nowrap">{paidText(line)}</span>{line.billingRefundAmount ? <span className="text-xs text-muted-foreground"> (낸 돈 {won(line.paidNet + line.billingRefundAmount)} · 환불 {won(line.billingRefundAmount)})</span> : null}</td>
    <td className="min-w-16 pr-2">{lineStatus(inv, line)}</td>
    <td>{line.refund
      ? <><WindowLink href={`/billing/refunds/${line.refund.documentId}`} title="환불 요청서" className="text-primary hover:underline">{line.refund.completed ? "환불 완료" : "데스크 환불 대기"}{line.refund.deskName ? ` · 담당 ${line.refund.deskName}` : ""} · 요청서</WindowLink>
        {re && <div className="mt-0.5 text-muted-foreground">{mark ? `${mark} · ` : ""}{increaseText(re, line.refund.completed, decisionOpen)}</div>}
        {re?.separable && decisionOpen && canDecide && <button type="button" disabled={pending} onClick={() => onSeparate(line.key)} className="mt-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 print:hidden">환불하지 않음 — 늘어난 몫은 수납에서 따로 처리</button>}
        {deduction && deduction.separate > 0 && <div className="mt-0.5 text-muted-foreground">{separatedText(deduction)}</div>}</>
      : !refundable(inv, line) ? <span className="text-muted-foreground">—</span>
      : pickable
        ? <span className="inline-flex flex-wrap items-center gap-2"><button type="button" role="switch" aria-checked={on} aria-label={`${label} 환불`} disabled={pending} onClick={() => onToggle(line.key)}
            className="inline-flex items-center gap-2 text-sm disabled:opacity-50 print:hidden"><span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${on ? "left-4" : "left-0.5"}`} /></span>{on ? "환불" : "안 함"}</button>
            {mark && <span className="text-muted-foreground">{mark}</span>}</span>
        : <span className="text-muted-foreground">{mark ?? "요청서 없음"}</span>}
      {/* 요청서가 지워진 줄을 다시 정할 때 — 이전 환불 완료 기록·따로 환불을 빼고 요청한다(리뷰 r3 R2-I2 · DB attach 상한과 같은 식). */}
      {!line.refund && deduction && <div className="mt-0.5 text-muted-foreground">{deductionText(deduction, remain)}</div>}
      {/* 다른 요청(묶음)의 요청서가 담은 줄 — 이 요청에선 줄을 잡지 않는다(원장 결정 대기 · 팀장 결정 2026-11-06). 참고로 그 요청서를 보인다.
          다시 고를 수 있는 것은 취소된 요청의 환불 전 요청서뿐(`reapprovable`) — 그 밖엔 '환불하지 않음'으로만 정한다(같은 돈 두 번 막기). */}
      {!line.refund && line.otherRefund && <div className="mt-0.5"><WindowLink href={`/billing/refunds/${line.otherRefund.documentId}`} title="환불 요청서" className="text-muted-foreground hover:underline">{otherRefundText(line.otherRefund)}</WindowLink></div>}</td>
  </tr>;
}
