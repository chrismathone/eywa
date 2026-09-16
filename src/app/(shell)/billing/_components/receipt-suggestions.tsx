"use client";
import type { ReceiptAllocationDraft } from "@/features/billing/session-terms/receipt-allocation";
import { applyReceiptSuggestion, canApplyReceiptSuggestion, type ReceiptSuggestion } from "@/features/billing/session-terms/receipt-suggestion";

export function ReceiptSuggestions({ suggestions = [], terms, draft, disabled, onChange }: {
  suggestions?: ReceiptSuggestion[]; terms: { id: string; className: string | null }[]; draft: ReceiptAllocationDraft;
  disabled: boolean; onChange: (draft: ReceiptAllocationDraft) => void;
}) {
  if (!suggestions.length) return null;
  return <div className="border-line mb-3 space-y-2 rounded-lg border p-3 text-sm">
    <b>자동 연결·배분 제안</b>
    <p className="text-text-dim text-xs">미저장 항목은 자동으로 채웠습니다. 기존 저장값은 유지하며, 변경 내용은 ‘배분 저장’을 누르면 반영됩니다.</p>
    {suggestions.map((s) => {
      const same = s.rows.every((r) => draft[r.termId]?.line === String(s.lineIndex) && Number(draft[r.termId]?.amount) === r.amount);
      const applicable = canApplyReceiptSuggestion(draft, s);
      return <div key={s.lineIndex} className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-text-dim text-xs">{s.reason}</p><p>{s.rows.map((r) => `${terms.find((t) => t.id === r.termId)?.className ?? "반"} ${r.amount.toLocaleString("ko-KR")}원`).join(" · ")}</p></div>
        {same ? <span className="text-primary text-xs">제안과 일치</span> : <button type="button" disabled={disabled || !applicable} title={applicable ? undefined : "다른 반의 연결을 먼저 확인해 주세요"} className="border-line rounded-md border px-3 py-1.5 text-xs disabled:opacity-40" onClick={() => onChange(applyReceiptSuggestion(draft, s))}>{s.kind === "transfer" ? "이력대로 배분" : "제안대로 연결"}</button>}
      </div>;
    })}
  </div>;
}
