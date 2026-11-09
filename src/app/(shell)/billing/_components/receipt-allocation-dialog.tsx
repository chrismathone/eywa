"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getReceiptAllocation, mergeReceiptItems, saveFreeReceiptAllocation, saveReceiptAllocation, type ReceiptAllocationView } from "@/features/billing/session-terms/server/receipt-allocation-actions";
import { initialFreeAmounts } from "@/features/billing/session-terms/free-allocation";
import { FreeAllocationPanel } from "./free-allocation-panel";
import { connectReceiptTerm, distributeLinkedReceipt, receiptAllocationSaveRows, receiptRemainder, type ReceiptAllocationDraft } from "@/features/billing/session-terms/receipt-allocation";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { receiptGroupId, remapReceiptDraft } from "@/features/billing/session-terms/receipt-merge";
import { ReceiptMergeControls } from "./receipt-merge-controls";
import { normalizeInvoiceLineItems } from "@/features/billing/invoice-line-items";
import { MergedReceiptDetails } from "./merged-receipt-details";
import { initialReceiptDraft } from "@/features/billing/session-terms/receipt-suggestion";
import { CELL_ACTION_BUTTON } from "./cell-action-button";
import { toast } from "sonner";
import { ReceiptSuggestions } from "./receipt-suggestions";
import { receiptRefundState } from "@/features/billing/session-terms/receipt-refund";
import { unlinkedZeroBlockers } from "@/features/billing/session-terms/unlinked-zero";
import { TERM_STATE_LABEL } from "@/features/billing/session-terms/month-roster";
import { tipProps } from "@/components/hover-tip/tip";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
/** 회차 행이 없는 줄(출석부엔 있는데 행이 없는 반) — 배분을 저장하는 순간 행이 생긴다(원장 2026-09-18). 문구는 `TERM_STATE_LABEL` 한 벌. */
const MISSING_TIP = tipProps({ title: TERM_STATE_LABEL.missing.label, lines: [TERM_STATE_LABEL.missing.tip] });

function AllocationDialog({ invoiceId, studentName, data: initialData, onClose }: { invoiceId: string; studentName: string; data: ReceiptAllocationView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState(initialData);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptAllocationDraft>(() => initialReceiptDraft(data.terms, data.suggestions));
  /**
   * 자유 배분(관리자 이상, 원장 2026-09-21) — 이미 자유 배분으로 저장한 청구서면 그 화면으로 연다. 처음 값은 **자동 배분이 먼저**
   * (지금 항목별 초안의 금액). `freeKey`를 올려 전환할 때마다 그때 초안으로 다시 채운다.
   */
  const [mode, setMode] = useState<"line" | "free">(() => (initialData.canFree && initialData.freeSaved ? "free" : "line"));
  const [freeKey, setFreeKey] = useState(0);
  useEffect(() => { ref.current?.showModal(); }, []);
  const groups = data.lines.map((line) => {
    const terms = data.terms.filter((term) => draft[term.id]?.line === String(line.index));
    const base = terms.reduce((sum, term) => sum + (term.amount ?? 0), 0);
    const total = terms.reduce((sum, term) => sum + (Number(draft[term.id].amount) || 0), 0);
    return { line, terms, base, total };
  });
  const hasLinks = data.terms.some((term) => draft[term.id].line !== "");
  // 확정 반을 '연결 안 함'으로 두면 0원으로 저장한다(원장 2026-09-17 *"연결 안함 처리시 자동으로 0"*) — 막는 건 사라진 항목을 가리키는 연결뿐.
  const complete = !hasLinks || data.terms.every((term) => term.confirmedSessions === null || draft[term.id].line === "" || data.lines.some((line) => String(line.index) === draft[term.id].line));
  const zeroCount = hasLinks ? data.terms.filter((term) => term.confirmedSessions !== null && draft[term.id].line === "").length : 0;
  // 0원이 빠뜨린 연결을 덮지 않게 — 0원 반에 이름이 맞는 항목이 있으면 저장하지 않고, 어느 반에도 안 붙은 수업 항목이 남으면
  // 저장할 때 한 번 확인받는다(받을 반이 없는 특강 항목 등 — 서버·DB도 같은 조건).
  const zeroBlock = unlinkedZeroBlockers(data.lines, data.terms, draft);
  const zeroBlocked = zeroBlock.matchedTerms.length > 0;
  const leftoverText = zeroBlock.unlinkedLines.map((l) => `${l.description || `항목 ${l.index + 1}`} ${won(l.amount)}`).join(", ");
  // 관리자가 자유 배분으로 저장한 청구서는 관리자만 바꾼다 — 관리자가 아니면 항목별 저장·합산을 잠근다(서버도 같은 판정으로 거절).
  const lockedByFree = !data.canFree && !!data.freeSaved;
  const valid = !reloadRequired && !lockedByFree && complete && !zeroBlocked && groups.every((group) => group.terms.length === 0 || (group.total === group.line.amount && group.terms.every((term) => draft[term.id].amount.trim() !== "" && Number.isSafeInteger(Number(draft[term.id].amount)) && Number(draft[term.id].amount) >= 0 && (term.confirmedSessions === null || term.pricingMode === "monthly" || term.confirmedSessions > 0 || Number(draft[term.id].amount) === 0))));
  function merge(indices: number[], label: string, removeId?: string) {
    if (pending || reloadRequired || lockedByFree) return;
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
  function saveFree(rows: { termId: string; amount: number }[]) {
    if (pending || reloadRequired) return;
    setError(null);
    start(async () => {
      try {
        const byId = new Map(data.terms.map((t) => [t.id, t]));
        const result = await saveFreeReceiptAllocation(invoiceId, data.source, rows.map((r) => ({ ...r, confirmedAt: byId.get(r.termId)?.confirmedAt ?? null, baseAmount: byId.get(r.termId)?.amount ?? null })));
        if (result.error) { setError(result.error); return; }
        // 이 배분으로 다음 달로 보낸 이월이 무효가 됐으면 알린다(2026-11-09).
        if (result.warning) toast.warning(result.warning, { duration: 15000 });
        publishRecordSaved("billing:session-terms");
        router.refresh();
        onClose();
      } catch { setError("배분을 저장하지 못했습니다. 다시 시도해 주세요"); }
    });
  }
  function save() {
    if (!valid || pending) return;
    const ackUnlinked = zeroBlock.unlinkedLines.length > 0;
    if (ackUnlinked && !confirm(`어느 반에도 연결하지 않은 수업 항목이 남습니다: ${leftoverText}
연결하지 않은 확정 반 ${zeroCount}개를 0원으로 저장할까요?`)) return;
    setError(null);
    start(async () => {
      try {
        const rows = receiptAllocationSaveRows(data.terms, draft, ackUnlinked);
        const result = await saveReceiptAllocation(invoiceId, data.source, rows);
        if (result.error) { setError(result.error); return; }
        // 이 저장으로 지난 달 이월이 실려 확정 시수를 자동으로 맞췄으면 알린다(원장 2026-10-07).
        if (result.notice) toast.success(result.notice);
        if (result.warning) toast.warning(result.warning, { duration: 15000 });
        publishRecordSaved("billing:session-terms");
        router.refresh();
        onClose();
      } catch { setError("배분을 저장하지 못했습니다. 다시 시도해 주세요"); }
    });
  }
  return <dialog ref={ref} data-no-drag-scroll aria-label={`${studentName} 수납 연결·배분`} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }} className="bg-card text-foreground fixed inset-0 m-auto max-h-[90vh] w-[min(960px,95vw)] overflow-auto rounded-xl border border-line p-5 whitespace-normal shadow-xl backdrop:bg-black/40">
    <header className="mb-4 flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-bold">{studentName} · 수납 연결·배분</h2><p className="text-text-dim mt-1 text-sm">할인 전 청구액을 반별로 배분합니다. 학부모 할인은 급여 기준에서 차감하지 않습니다.</p><p className="text-text-dim mt-1 text-sm">미확정 반도 연결할 수 있으며, 항목을 선택하면 그 반에 남은 금액이 자동 입력됩니다.</p></div>
      <button type="button" disabled={pending} onClick={onClose} className="shrink-0 text-sm whitespace-nowrap">닫기</button>
    </header>
    <p className="text-text-dim mb-3 text-xs">{data.period ? `${data.period} 청구월` : "청구월"}에 수강한 반을 표시합니다. 월중 종료·이동 전 반도 해당 월 정산에 포함됩니다.</p>
    {data.terms.some((t) => t.refundState === "full") ? <p role="status" className="text-text-dim mb-3 text-sm">전액 환불한 수업의 배분·급여 기준은 0원입니다. 원 청구액과 할인·납부 기록은 보존됩니다.</p> : null}
    {Array.isArray(data.source) && data.source.some((line) => receiptRefundState(line) === "partial") ? <p role="alert" className="text-amber mb-3 text-sm">부분 환불 항목은 급여 기준액 확인이 필요하여 자동 배분에서 제외했습니다.</p> : null}
    {data.lines.some((line) => receiptGroupId(line) && receiptRefundState(line.source) === "mixed") ? <p role="alert" className="text-amber mb-3 text-sm">환불한 수업과 남은 수업이 함께 합산되어 있습니다. 아래 ‘합산 해제’ 후 항목별로 다시 배분해 주세요.</p> : null}
    {data.canFree ? (
      <div className="mb-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="배분 방식">
        {([["line", "항목별 배분"], ["free", "자유 배분(관리자)"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} disabled={pending} onClick={() => { if (mode !== v) { setMode(v); if (v === "free") setFreeKey((k) => k + 1); } }}
            className={mode === v ? "border-primary bg-primary-soft text-primary rounded-lg border px-3 py-1.5 text-sm font-bold" : "border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-sm font-bold"}>{label}</button>
        ))}
        <span className="text-text-dim text-xs">{mode === "free" ? "수납 항목과 상관없이 반마다 금액을 나눕니다 — 합계는 수업 청구액 이하." : "수납 항목마다 합계를 청구액과 맞춥니다(자동 배분 기본)."}</span>
      </div>
    ) : data.freeSaved ? <p role="status" className="text-amber mb-3 text-sm">관리자가 자유 배분으로 저장한 청구서입니다 — 관리자만 바꿀 수 있습니다.</p> : null}
    {mode === "free" && data.freeSaved && data.terms.some((t) => t.allocationStale) ? (
      // 무효가 된 게 저장한 금액 줄인지, 금액을 정한 적 없는 반(새로 확정)뿐인지 가른다 — 후자면 저장한 배분은 아직 그대로 쓰인다.
      data.terms.some((t) => t.allocationStale && (t.savedAllocationAmount ?? 0) > 0)
        ? <p role="status" className="text-amber mb-3 text-sm">청구 항목이나 반 확정값이 바뀌어 저장한 자유 배분을 지금은 쓰지 않습니다 — 저장했던 금액을 채워 두었으니 확인하고 다시 저장해 주세요.</p>
        : <p role="status" className="text-amber mb-3 text-sm">금액을 정하지 않은 확정 반이 있습니다({data.terms.filter((t) => t.allocationStale).map((t) => t.className ?? "반").join(", ")}) — 금액을 적고(0원도 됩니다) 다시 저장해 주세요.</p>
    ) : null}
    {mode === "free" ? (
      <>
        <FreeAllocationPanel key={freeKey} total={data.tuitionTotal ?? 0} pending={pending || reloadRequired}
          terms={data.terms.map((t) => ({ id: t.id, className: t.className, confirmedSessions: t.confirmedSessions, pricingMode: t.pricingMode, amount: t.amount, termState: t.termState, enrollmentLabel: t.enrollmentLabel, fullyRefunded: t.refundState === "full" }))}
          initial={initialFreeAmounts(data.terms, draft, !!data.freeSaved)} onSave={saveFree} />
        {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
      </>
    ) : <>
    <ReceiptMergeControls key={JSON.stringify(data.source)} lines={data.lines} disabled={pending || reloadRequired || lockedByFree} onMerge={merge} />
    {notice ? <p role="status" className="text-green mb-3 text-sm">{notice}</p> : null}
    {data.terms.some((term) => term.allocationStale) ? <p role="alert" className="text-amber mb-3 text-sm">청구액이나 반 확정값이 바뀌었습니다. 연결과 배분을 다시 확인해 주세요.</p> : null}
    <ReceiptSuggestions suggestions={data.suggestions} terms={data.terms} draft={draft} disabled={pending || reloadRequired} onChange={setDraft} />
    <div className="space-y-2">
      {groups.map(({ line, terms, base, total }) => <div key={line.index} className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="text-sm"><b>{line.description || `수납 항목 ${line.index + 1}`}</b>{receiptGroupId(line) ? <button type="button" disabled={pending || reloadRequired} className="text-primary ml-2 text-xs hover:underline" onClick={() => merge([], "", receiptGroupId(line)!)}>합산 해제</button> : null}<div className="text-text-dim mt-1">청구 {won(line.amount)} · 반 확정 합계 {won(base)} · 차액 {won(line.amount - base)}</div><div className={terms.length > 0 && total !== line.amount ? "text-amber" : "text-text-dim"}>연결 {terms.length}개 반 · 배분 합계 {won(total)} · 남은 금액 {won(line.amount - total)}</div><MergedReceiptDetails line={normalizeInvoiceLineItems([line.source])[0]} /></div>
        {(() => {
          // 눌러도 입력값이 그대로면(차액 0·이미 그 비율) 잠근다 — 활성처럼 보이는데 아무 일도 안 일어나면 고장으로 읽힌다(원장 2026-09-17).
          const splitting = terms.some((term) => term.confirmedSessions === null);
          const amounts = distributeLinkedReceipt(line, terms, draft);
          const nothing = Object.keys(amounts).length === 0;
          const noChange = nothing || Object.entries(amounts).every(([id, amount]) => draft[id]?.amount === String(amount));
          return <button type="button" disabled={pending || terms.length === 0 || (base <= 0 && !splitting) || noChange} className="border-line hover:bg-bg-soft rounded-md border px-3 py-1.5 text-sm disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent" title={noChange && terms.length > 0 ? (base <= 0 && !splitting ? "확정금액이 없어 비율로 나눌 수 없습니다" : nothing ? "나눌 금액이 없습니다" : "입력한 금액이 이미 나눈 결과와 같습니다") : splitting ? "확정 반의 입력액은 유지하고 남은 금액을 미확정 반에 똑같이 나눕니다" : "확정금액 비율로 청구액을 나눕니다"} onClick={() => {
            setDraft((current) => ({ ...current, ...Object.fromEntries(Object.entries(distributeLinkedReceipt(line, terms, current)).map(([id, amount]) => [id, { ...current[id], amount: String(amount) }])) }));
          }}>{splitting ? "남은 금액 나누기" : "차액 비례 배분"}</button>;
        })()}
      </div>)}
      {data.lines.length === 0 ? <p className="text-text-dim text-sm">연결할 수업 청구 항목이 없습니다.</p> : null}
    </div>
    <div className="my-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-line border-b"><th className="py-2">반</th><th>확정금액</th><th>연결할 수납 항목</th><th>배분금액</th></tr></thead><tbody>
      {data.terms.map((term) => {
        const line = data.lines.find((row) => String(row.index) === draft[term.id].line);
        const remaining = line ? receiptRemainder(line, term.id, draft) : null;
        return <tr key={term.id} className="border-line border-b">
          <td className="py-3 pr-3">{term.className}{term.termState === "missing" ? <span className="text-amber bg-amber-soft ml-2 cursor-help rounded-sm px-1.5 py-0.5 text-xs font-medium" {...MISSING_TIP}>{TERM_STATE_LABEL.missing.label}</span> : term.confirmedSessions === null ? <span className="text-amber ml-2">미확정</span> : null}{term.enrollmentLabel ? <span className="text-text-dim mt-1 block text-xs">{term.enrollmentLabel}</span> : null}</td>
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
            <input aria-label={`${term.className} 배분금액`} type="number" min="0" step="1" disabled={pending || !line} value={line ? draft[term.id].amount : hasLinks && term.confirmedSessions !== null ? "0" : ""} onChange={(e) => setDraft((current) => ({ ...current, [term.id]: { ...current[term.id], amount: e.target.value } }))} className="border-input bg-background num w-28 rounded-md border px-2 py-1.5 text-right" />
            {remaining !== null ? <button type="button" disabled={pending} aria-label={`${term.className} 남은 금액 적용`} className="text-primary mt-1 block text-xs hover:underline disabled:opacity-40" onClick={() => setDraft((current) => ({ ...current, [term.id]: { ...current[term.id], amount: String(receiptRemainder(line!, term.id, current)) } }))}>잔액 {won(remaining)} 적용</button> : null}
          </td>
        </tr>;
      })}
    </tbody></table></div>
    <p className="text-text-dim mb-3 text-sm">배분만 저장하면 시수는 미확정으로 유지됩니다. 시수 확정 후 ‘회차 확정 → 청구 시수 대조’에서 청구 분배 기록을 저장할 수 있습니다. 실제 급여는 출석부 기준입니다.{data.terms.some((term) => term.termState === "missing") ? " ‘회차 없음’ 반은 배분을 저장하는 순간 회차 행이 만들어집니다." : ""}</p>
    <footer className="flex items-center justify-between gap-4"><div className="text-text-dim text-sm">{error ? <p role="alert" className="text-danger">{error}</p> : lockedByFree ? "관리자가 자유 배분으로 저장한 청구서라 항목별로 저장할 수 없습니다." : !complete ? "연결한 수납 항목을 다시 선택해 주세요." : zeroBlock.matchedTerms.length ? `${zeroBlock.matchedTerms.map((t) => t.className ?? "반").join(", ")}에 맞는 수납 항목이 있습니다. 0원으로 두지 말고 연결해 주세요.` : !valid ? "각 수납 항목의 배분 합계를 청구액과 맞춰 주세요." : hasLinks ? `${zeroCount ? `연결하지 않은 확정 반 ${zeroCount}개는 0원으로 저장합니다. ${zeroBlock.unlinkedLines.length ? `어느 반에도 연결하지 않은 수업 항목이 남습니다(${leftoverText}). ` : ""}` : ""}배분금액을 저장합니다.` : "연결 없이 저장하면 기존 배분을 해제합니다."}</div><button type="button" disabled={pending || !valid} onClick={save} className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-sm font-bold disabled:opacity-40">{pending ? "저장 중…" : "배분 저장"}</button></footer>
    </>}
  </dialog>;
}

export function ReceiptAllocationButton({ invoiceId, studentName }: { invoiceId: string; studentName: string }) {
  const [data, setData] = useState<ReceiptAllocationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return <><button type="button" disabled={pending} aria-busy={pending} className={CELL_ACTION_BUTTON} onClick={() => start(async () => {
    setError(null);
    try { const result = await getReceiptAllocation(invoiceId); if (result.error) setError(result.error); else if (result.data) setData(result.data); }
    catch { setError("수납 연결 정보를 불러오지 못했습니다"); }
  })}>배분</button>{error ? <p role="alert" className="text-danger basis-full text-xs whitespace-normal">{error}</p> : null}{data ? <AllocationDialog invoiceId={invoiceId} studentName={studentName} data={data} onClose={() => setData(null)} /> : null}</>;
}
