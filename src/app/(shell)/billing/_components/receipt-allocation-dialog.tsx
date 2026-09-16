"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getReceiptAllocation, mergeReceiptItems, saveReceiptAllocation, type ReceiptAllocationView } from "@/features/billing/session-terms/server/receipt-allocation-actions";
import { connectReceiptTerm, distributeLinkedReceipt, receiptRemainder, type ReceiptAllocationDraft } from "@/features/billing/session-terms/receipt-allocation";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { receiptGroupId, remapReceiptDraft } from "@/features/billing/session-terms/receipt-merge";
import { ReceiptMergeControls } from "./receipt-merge-controls";
import { normalizeInvoiceLineItems } from "@/features/billing/invoice-line-items";
import { MergedReceiptDetails } from "./merged-receipt-details";
import { initialReceiptDraft } from "@/features/billing/session-terms/receipt-suggestion";
import { ReceiptSuggestions } from "./receipt-suggestions";
import { receiptRefundState } from "@/features/billing/session-terms/receipt-refund";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function AllocationDialog({ invoiceId, studentName, data: initialData, onClose }: { invoiceId: string; studentName: string; data: ReceiptAllocationView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState(initialData);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptAllocationDraft>(() => initialReceiptDraft(data.terms, data.suggestions));
  useEffect(() => { ref.current?.showModal(); }, []);
  const groups = data.lines.map((line) => {
    const terms = data.terms.filter((term) => draft[term.id]?.line === String(line.index));
    const base = terms.reduce((sum, term) => sum + (term.amount ?? 0), 0);
    const total = terms.reduce((sum, term) => sum + (Number(draft[term.id].amount) || 0), 0);
    return { line, terms, base, total };
  });
  const hasLinks = data.terms.some((term) => draft[term.id].line !== "");
  const complete = !hasLinks || data.terms.every((term) => term.confirmedSessions === null || data.lines.some((line) => String(line.index) === draft[term.id].line));
  const valid = !reloadRequired && complete && groups.every((group) => group.terms.length === 0 || (group.total === group.line.amount && group.terms.every((term) => draft[term.id].amount.trim() !== "" && Number.isSafeInteger(Number(draft[term.id].amount)) && Number(draft[term.id].amount) >= 0 && (term.confirmedSessions === null || term.pricingMode === "monthly" || term.confirmedSessions > 0 || Number(draft[term.id].amount) === 0))));
  function merge(indices: number[], label: string, removeId?: string) {
    if (pending || reloadRequired) return;
    setError(null); setNotice(null);
    start(async () => {
      try {
        const result = await mergeReceiptItems(invoiceId, data.source, indices, label, removeId);
        if (result.error || !result.data) { setError(result.error ?? "수납 정보를 다시 확인해 주세요"); if (result.committed) setReloadRequired(true); return; }
        const next = result.data;
        setDraft((current) => {
          const moved = remapReceiptDraft(data.lines, next.lines, current);
          return Object.fromEntries(next.terms.map((term) => [term.id, moved[term.id] ?? { line: term.allocationStale || term.allocationLineIndex == null ? "" : String(term.allocationLineIndex), amount: String(term.allocatedAmount ?? term.amount ?? "") }]));
        });
        setData(next); setNotice(removeId ? "합산을 해제했습니다. 연결이 풀린 반의 배분을 다시 선택해 주세요." : "수납 항목을 합산했습니다. 입력 중인 배분금액은 유지했습니다.");
        publishRecordSaved("billing:session-terms"); router.refresh();
      } catch { setReloadRequired(true); setError("합산 결과를 확인하지 못했습니다. 창을 다시 열어 확인해 주세요."); }
    });
  }
  function save() {
    if (!valid || pending) return;
    setError(null);
    start(async () => {
      try {
        const rows = data.terms.filter((term) => draft[term.id].line !== "").map((term) => ({ termId: term.id, lineIndex: Number(draft[term.id].line), amount: Number(draft[term.id].amount), baseAmount: term.amount, confirmedAt: term.confirmedAt }));
        const result = await saveReceiptAllocation(invoiceId, data.source, rows);
        if (result.error) { setError(result.error); return; }
        publishRecordSaved("billing:session-terms");
        router.refresh();
        onClose();
      } catch { setError("배분을 저장하지 못했습니다. 다시 시도해 주세요"); }
    });
  }
  return <dialog ref={ref} data-no-drag-scroll aria-label={`${studentName} 수납 연결·배분`} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }} className="bg-card text-foreground fixed inset-0 m-auto max-h-[90vh] w-[min(960px,95vw)] overflow-auto rounded-xl border border-line p-5 whitespace-normal shadow-xl backdrop:bg-black/40">
    <header className="mb-4 flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-bold">{studentName} · 수납 연결·배분</h2><p className="text-text-dim mt-1 text-sm">할인 전 청구액을 반별로 배분합니다. 학부모 할인은 급여 기준에서 차감하지 않습니다.</p><p className="text-text-dim mt-1 text-sm">미확정 반도 연결할 수 있으며, 항목을 선택하면 그 반에 남은 금액이 자동 입력됩니다.</p></div>
      <button type="button" disabled={pending} onClick={onClose} className="text-sm">닫기</button>
    </header>
    <p className="text-text-dim mb-3 text-xs">{data.period ? `${data.period} 청구월` : "청구월"}에 수강한 반을 표시합니다. 월중 종료·이동 전 반도 해당 월 정산에 포함됩니다.</p>
    {data.terms.some((t) => t.refundState === "full") ? <p role="status" className="text-text-dim mb-3 text-sm">전액 환불한 수업의 배분·급여 기준은 0원입니다. 원 청구액과 할인·납부 기록은 보존됩니다.</p> : null}
    {Array.isArray(data.source) && data.source.some((line) => receiptRefundState(line) === "partial") ? <p role="alert" className="text-amber mb-3 text-sm">부분 환불 항목은 급여 기준액 확인이 필요하여 자동 배분에서 제외했습니다.</p> : null}
    <ReceiptMergeControls key={JSON.stringify(data.source)} lines={data.lines} disabled={pending || reloadRequired} onMerge={merge} />
    {notice ? <p role="status" className="text-green mb-3 text-sm">{notice}</p> : null}
    {data.terms.some((term) => term.allocationStale) ? <p role="alert" className="text-amber mb-3 text-sm">청구액이나 반 확정값이 바뀌었습니다. 연결과 배분을 다시 확인해 주세요.</p> : null}
    <ReceiptSuggestions suggestions={data.suggestions} terms={data.terms} draft={draft} disabled={pending || reloadRequired} onChange={setDraft} />
    <div className="space-y-2">
      {groups.map(({ line, terms, base, total }) => <div key={line.index} className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="text-sm"><b>{line.description || `수납 항목 ${line.index + 1}`}</b>{receiptGroupId(line) ? <button type="button" disabled={pending || reloadRequired} className="text-primary ml-2 text-xs hover:underline" onClick={() => merge([], "", receiptGroupId(line)!)}>합산 해제</button> : null}<div className="text-text-dim mt-1">청구 {won(line.amount)} · 반 확정 합계 {won(base)} · 차액 {won(line.amount - base)}</div><div className={terms.length > 0 && total !== line.amount ? "text-amber" : "text-text-dim"}>연결 {terms.length}개 반 · 배분 합계 {won(total)} · 남은 금액 {won(line.amount - total)}</div><MergedReceiptDetails line={normalizeInvoiceLineItems([line.source])[0]} /></div>
        <button type="button" disabled={pending || terms.length === 0 || (base <= 0 && !terms.some((term) => term.confirmedSessions === null))} className="border-line rounded-md border px-3 py-1.5 text-sm disabled:opacity-40" title={terms.some((term) => term.confirmedSessions === null) ? "확정 반의 입력액은 유지하고 남은 금액을 미확정 반에 똑같이 나눕니다" : "확정금액 비율로 청구액을 나눕니다"} onClick={() => {
          setDraft((current) => {
            const amounts = distributeLinkedReceipt(line, terms, current);
            return { ...current, ...Object.fromEntries(Object.entries(amounts).map(([id, amount]) => [id, { ...current[id], amount: String(amount) }])) };
          });
        }}>{terms.some((term) => term.confirmedSessions === null) ? "남은 금액 나누기" : "차액 비례 배분"}</button>
      </div>)}
      {data.lines.length === 0 ? <p className="text-text-dim text-sm">연결할 수업 청구 항목이 없습니다.</p> : null}
    </div>
    <div className="my-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-line border-b"><th className="py-2">반</th><th>확정금액</th><th>연결할 수납 항목</th><th>배분금액</th></tr></thead><tbody>
      {data.terms.map((term) => {
        const line = data.lines.find((row) => String(row.index) === draft[term.id].line);
        const remaining = line ? receiptRemainder(line, term.id, draft) : null;
        return <tr key={term.id} className="border-line border-b">
          <td className="py-3 pr-3">{term.className}{term.confirmedSessions === null ? <span className="text-amber ml-2">미확정</span> : null}{term.enrollmentLabel ? <span className="text-text-dim mt-1 block text-xs">{term.enrollmentLabel}</span> : null}</td>
          <td className="num pr-3">{term.amount === null ? "—" : won(term.amount)}</td>
          <td className="pr-3">
            <select aria-label={`${term.className} 수납 항목`} disabled={pending} value={draft[term.id].line} className="border-input bg-background max-w-64 rounded-md border px-2 py-1.5" onChange={(e) => {
              const target = data.lines.find((row) => String(row.index) === e.target.value);
              setDraft((current) => connectReceiptTerm(current, term, target));
            }}>
              <option value="">연결 안 함</option>
              {data.lines.map((row) => <option key={row.index} value={row.index}>{row.description || `항목 ${row.index + 1}`} · {won(row.amount)}{receiptRefundState(row.source) === "full" ? " · 전액 환불" : ""}</option>)}
            </select>
          </td>
          <td className="py-2">
            <input aria-label={`${term.className} 배분금액`} type="number" min="0" step="1" disabled={pending || !line} value={draft[term.id].amount} onChange={(e) => setDraft((current) => ({ ...current, [term.id]: { ...current[term.id], amount: e.target.value } }))} className="border-input bg-background num w-28 rounded-md border px-2 py-1.5 text-right" />
            {remaining !== null ? <button type="button" disabled={pending} aria-label={`${term.className} 남은 금액 적용`} className="text-primary mt-1 block text-xs hover:underline disabled:opacity-40" onClick={() => setDraft((current) => ({ ...current, [term.id]: { ...current[term.id], amount: String(receiptRemainder(line!, term.id, current)) } }))}>잔액 {won(remaining)} 적용</button> : null}
          </td>
        </tr>;
      })}
    </tbody></table></div>
    <p className="text-text-dim mb-3 text-sm">배분만 저장하면 시수는 미확정으로 유지됩니다. 시수 확정 후 ‘시수 검증 → 분배 저장’을 하면 강사 정산에 반영됩니다.</p>
    <footer className="flex items-center justify-between gap-4"><div className="text-text-dim text-sm">{error ? <p role="alert" className="text-danger">{error}</p> : !complete ? "확정한 모든 반을 수납 항목에 연결해 주세요." : !valid ? "각 수납 항목의 배분 합계를 청구액과 맞춰 주세요." : hasLinks ? "저장한 배분금액에 강사 배분율을 적용합니다." : "연결 없이 저장하면 기존 배분을 해제합니다."}</div><button type="button" disabled={pending || !valid} onClick={save} className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-sm font-bold disabled:opacity-40">{pending ? "저장 중…" : "배분 저장"}</button></footer>
  </dialog>;
}

export function ReceiptAllocationButton({ invoiceId, studentName }: { invoiceId: string; studentName: string }) {
  const [data, setData] = useState<ReceiptAllocationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return <><button type="button" disabled={pending} className="text-primary text-xs underline-offset-2 hover:underline disabled:opacity-50" onClick={() => start(async () => {
    setError(null);
    try { const result = await getReceiptAllocation(invoiceId); if (result.error) setError(result.error); else if (result.data) setData(result.data); }
    catch { setError("수납 연결 정보를 불러오지 못했습니다"); }
  })}>{pending ? "불러오는 중…" : "수납 연결·배분"}</button>{error ? <p role="alert" className="text-danger basis-full text-xs whitespace-normal">{error}</p> : null}{data ? <AllocationDialog invoiceId={invoiceId} studentName={studentName} data={data} onClose={() => setData(null)} /> : null}</>;
}
