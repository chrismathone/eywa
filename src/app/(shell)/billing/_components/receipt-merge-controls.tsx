"use client";

import { useState } from "react";
import type { ReceiptLine } from "@/features/billing/session-terms/receipt-allocation";
import { canMergeReceipt } from "@/features/billing/session-terms/receipt-merge";

export function ReceiptMergeControls({ lines, disabled, onMerge }: { lines: ReceiptLine[]; disabled: boolean; onMerge: (indices: number[], label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const chosen = lines.filter((l) => selected.includes(l.index));
  const defaultLabel = [...new Set(chosen.map((l) => l.description))].join(" + ").slice(0, 200);
  return <div className="mb-3">
    <button type="button" disabled={disabled} className="text-primary text-sm hover:underline disabled:opacity-40" onClick={() => setOpen((v) => !v)}>{open ? "합산 선택 접기" : "수납 항목 합산"}</button>
    {open ? <div className="border-line bg-bg-soft mt-2 space-y-3 rounded-lg border p-3 text-sm">
      <p>반 이동으로 나뉜 수납 항목을 선택하세요. 원본 납부 내역은 보존하고, 다음 동기화에도 같은 항목끼리 합산합니다.</p>
      <div className="space-y-2">{lines.map((line) => <label key={line.index} className="flex items-start gap-2">
        <input type="checkbox" aria-label={`${line.description} 합산 선택`} disabled={disabled || !canMergeReceipt(line)} checked={selected.includes(line.index)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, line.index] : prev.filter((i) => i !== line.index))} className="mt-1" />
        <span className="min-w-0">{line.description} · {line.amount.toLocaleString("ko-KR")}원{!canMergeReceipt(line) ? <small className="text-text-dim ml-2">원본 납부·미납 내역 확인 필요</small> : null}</span>
      </label>)}</div>
      <div className="flex flex-wrap items-center gap-2"><input aria-label="합산 수납명" maxLength={200} disabled={disabled} value={label} placeholder={defaultLabel || "합산 수납명 (선택 시 자동 생성)"} onChange={(e) => setLabel(e.target.value)} className="border-input bg-background min-w-40 flex-1 rounded-md border px-2 py-1.5" />
        <b>{chosen.length}개 · 합계 {chosen.reduce((sum, l) => sum + l.amount, 0).toLocaleString("ko-KR")}원</b>
        <button type="button" disabled={disabled || chosen.length < 2} onClick={() => onMerge(selected, label.trim() || defaultLabel)} className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 disabled:opacity-40">선택 항목 합산</button>
      </div><p className="text-text-dim text-xs">합산은 바로 저장됩니다. 입력 중인 배분금액은 유지되며, 배분 변경은 아래 ‘배분 저장’으로 저장하세요.</p>
    </div> : null}
  </div>;
}
