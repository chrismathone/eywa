"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getReceiptAllocation, saveReceiptAllocation, type ReceiptAllocationView } from "@/features/billing/session-terms/server/receipt-allocation-actions";
import { connectReceiptTerm, distributeLinkedReceipt, receiptRemainder, type ReceiptAllocationDraft } from "@/features/billing/session-terms/receipt-allocation";
import { publishRecordSaved } from "@/lib/realtime/record-channel";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function AllocationDialog({ invoiceId, studentName, data, onClose }: { invoiceId: string; studentName: string; data: ReceiptAllocationView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptAllocationDraft>(() => Object.fromEntries(data.terms.map((term) => [term.id, { line: term.allocationStale || term.allocationLineIndex == null ? "" : String(term.allocationLineIndex), amount: String(term.allocatedAmount ?? term.amount ?? "") }])));
  useEffect(() => { ref.current?.showModal(); }, []);
  const groups = data.lines.map((line) => {
    const terms = data.terms.filter((term) => draft[term.id]?.line === String(line.index));
    const base = terms.reduce((sum, term) => sum + (term.amount ?? 0), 0);
    const total = terms.reduce((sum, term) => sum + (Number(draft[term.id].amount) || 0), 0);
    return { line, terms, base, total };
  });
  const hasLinks = data.terms.some((term) => draft[term.id].line !== "");
  const complete = !hasLinks || data.terms.every((term) => term.confirmedSessions === null || data.lines.some((line) => String(line.index) === draft[term.id].line));
  const valid = complete && groups.every((group) => group.terms.length === 0 || (group.total === group.line.amount && group.terms.every((term) => draft[term.id].amount.trim() !== "" && Number.isSafeInteger(Number(draft[term.id].amount)) && Number(draft[term.id].amount) >= 0 && (term.confirmedSessions === null || term.pricingMode === "monthly" || term.confirmedSessions > 0 || Number(draft[term.id].amount) === 0))));
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
  return <dialog ref={ref} aria-label={`${studentName} 수납 연결·배분`} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }} className="bg-card text-foreground fixed inset-0 m-auto max-h-[90vh] w-[min(960px,95vw)] overflow-auto rounded-xl border border-line p-5 shadow-xl backdrop:bg-black/40">
    <header className="mb-4 flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-bold">{studentName} · 수납 연결·배분</h2><p className="text-text-dim mt-1 text-sm">할인 전 청구액을 반별로 배분합니다. 학부모 할인은 급여 기준에서 차감하지 않습니다.</p><p className="text-text-dim mt-1 text-sm">미확정 반도 연결할 수 있으며, 항목을 선택하면 그 반에 남은 금액이 자동 입력됩니다.</p></div>
      <button type="button" disabled={pending} onClick={onClose} className="text-sm">닫기</button>
    </header>
    {data.terms.some((term) => term.allocationStale) ? <p role="alert" className="text-amber mb-3 text-sm">청구액이나 반 확정값이 바뀌었습니다. 연결과 배분을 다시 확인해 주세요.</p> : null}
    <div className="space-y-2">
      {groups.map(({ line, terms, base, total }) => <div key={line.index} className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="text-sm"><b>{line.description || `수납 항목 ${line.index + 1}`}</b><div className="text-text-dim mt-1">청구 {won(line.amount)} · 반 확정 합계 {won(base)} · 차액 {won(line.amount - base)}</div><div className={terms.length > 0 && total !== line.amount ? "text-amber" : "text-text-dim"}>연결 {terms.length}개 반 · 배분 합계 {won(total)} · 남은 금액 {won(line.amount - total)}</div></div>
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
          <td className="py-3 pr-3">{term.className}{term.confirmedSessions === null ? <span className="text-amber ml-2">미확정</span> : null}</td>
          <td className="num pr-3">{term.amount === null ? "—" : won(term.amount)}</td>
          <td className="pr-3">
            <select aria-label={`${term.className} 수납 항목`} disabled={pending} value={draft[term.id].line} className="border-input bg-background max-w-64 rounded-md border px-2 py-1.5" onChange={(e) => {
              const target = data.lines.find((row) => String(row.index) === e.target.value);
              setDraft((current) => connectReceiptTerm(current, term, target));
            }}>
              <option value="">연결 안 함</option>
              {data.lines.map((row) => <option key={row.index} value={row.index}>{row.description || `항목 ${row.index + 1}`} · {won(row.amount)}</option>)}
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
  return <><button type="button" disabled={pending} className="text-primary mt-1 text-xs underline-offset-2 hover:underline disabled:opacity-50" onClick={() => start(async () => {
    setError(null);
    try { const result = await getReceiptAllocation(invoiceId); if (result.error) setError(result.error); else if (result.data) setData(result.data); }
    catch { setError("수납 연결 정보를 불러오지 못했습니다"); }
  })}>{pending ? "불러오는 중…" : "수납 연결·배분"}</button>{error ? <p role="alert" className="text-danger text-xs">{error}</p> : null}{data ? <AllocationDialog invoiceId={invoiceId} studentName={studentName} data={data} onClose={() => setData(null)} /> : null}</>;
}
