"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Paperclip, Pencil, Plus, Receipt, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WindowLink } from "@/components/workspace/window-link";
import { ExpenseDialog } from "@/app/(shell)/billing/_components/expense-dialog";
import { ExpenseReceiptsModal } from "@/app/(shell)/billing/_components/expense-receipts-modal";
import { deleteExpense } from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";
import { formatMoney } from "@/features/billing/currencies";

const CAT_COLOR: Record<string, PillColor> = {
  인건비: "purple",
  운영비: "blue",
  매입: "amber",
  마케팅: "rose",
  기타: "neutral",
};

// 사무실이 결재를 시작(원장·대표 중 하나라도 체크)하면 강사는 수정/삭제 불가 — 서버 guardOwnExpense와 동일 기준.
function isLocked(r: ExpenseRow): boolean {
  return !!(r.approvalChecks.director?.checked || r.approvalChecks.ceo?.checked);
}
function statusLabel(r: ExpenseRow): { label: string; color: PillColor } {
  if (r.approvalStatus === "approved") return { label: "결재완료", color: "primary" };
  if (isLocked(r)) return { label: "결재중", color: "amber" };
  return { label: "제출됨", color: "neutral" };
}

export function ExpenseRequestsClient({
  rows,
  requesterName,
}: {
  rows: ExpenseRow[];
  requesterName: string;
}) {
  const [dialog, setDialog] = useState<{ expense: ExpenseRow | null } | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function doDelete(r: ExpenseRow) {
    const fd = new FormData();
    fd.append("id", r.id);
    setBusy(r.id);
    startTransition(async () => {
      await deleteExpense(undefined, fd);
      setBusy(null);
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="text-primary size-5" />
          <div>
            <h1 className="text-foreground text-[19px] font-bold">지출결의서</h1>
            <p className="text-text-dim text-[13px]">
              지출 내역을 작성해 제출하면 사무실에서 원장·대표 결재 후 처리합니다. 본인이 작성한 결의서만 표시됩니다.
            </p>
          </div>
        </div>
        <Button onClick={() => setDialog({ expense: null })}>
          <Plus className="size-4" />새 지출결의서
        </Button>
      </header>

      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-md border border-dashed px-4 py-12 text-center text-sm">
          제출한 지출결의서가 없습니다. 위 “새 지출결의서”로 작성하세요.
        </div>
      ) : (
        <DragScrollArea className="bg-card border-line shadow-card rounded-md border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-3 py-2 text-left">지출일</th>
                <th className="micro px-3 py-2 text-left">제목</th>
                <th className="micro px-3 py-2 text-left">분류</th>
                <th className="micro px-3 py-2 text-right">총액</th>
                <th className="micro px-2 py-2 text-center">증빙</th>
                <th className="micro px-2 py-2 text-center">결재</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => {
                const isBusy = busy === r.id;
                const locked = isLocked(r);
                const status = statusLabel(r);
                const count = r.lineItems?.length ?? 0;
                return (
                  <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                    <td className="num text-text-dim px-3 py-2 text-xs whitespace-nowrap">{r.expenseDate}</td>
                    <td className="text-foreground px-3 py-2 text-xs">
                      <WindowLink
                        href={`/expense-requests/${r.id}`}
                        title={r.title}
                        className="hover:text-primary font-medium hover:underline"
                      >
                        {r.title}
                      </WindowLink>
                      {count > 0 ? <span className="text-text-faint"> ({count}건)</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Pill color={CAT_COLOR[r.category] ?? "neutral"}>{r.category}</Pill>
                    </td>
                    <td className="num text-danger px-3 py-2 text-right text-xs font-medium whitespace-nowrap">
                      {formatMoney(r.amount, r.currency)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setReceiptsFor(r)}
                        className="text-text-faint hover:text-foreground focus-visible:ring-primary/50 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] focus:outline-none focus-visible:ring-1"
                        title={`증빙자료${r.receiptType ? ` · ${r.receiptType}` : ""}`}
                        aria-label={`${r.title} 증빙자료 ${r.receiptUrls.length > 0 ? `${r.receiptUrls.length}건` : "없음"}`}
                      >
                        <Paperclip className={`size-3.5 shrink-0 ${r.receiptUrls.length > 0 ? "text-blue" : ""}`} />
                        {r.receiptUrls.length > 0 ? <span className="text-blue num shrink-0">{r.receiptUrls.length}</span> : null}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="inline-flex items-center gap-1">
                        {r.approvalStatus === "approved" ? <Check className="text-green size-3.5" strokeWidth={2.5} /> : null}
                        <Pill color={status.color}>{status.label}</Pill>
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        {locked ? (
                          <span className="text-text-faint px-1 text-[11px]" title="사무실 결재가 시작되어 수정할 수 없습니다">
                            잠김
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setDialog({ expense: r })}
                              disabled={isBusy}
                              className="text-text-faint hover:text-foreground p-1"
                              aria-label="수정"
                              title="수정"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(r)}
                              disabled={isBusy}
                              className="text-text-faint hover:text-danger p-1"
                              aria-label="삭제"
                              title="삭제"
                            >
                              {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DragScrollArea>
      )}

      {dialog ? <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} /> : null}

      {receiptsFor ? (
        <ExpenseReceiptsModal expense={receiptsFor} onClose={() => setReceiptsFor(null)} />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title="지출결의서 삭제"
        message={confirmDelete ? `'${confirmDelete.title}' 지출결의서를 삭제합니다. 되돌릴 수 없습니다.` : ""}
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          const r = confirmDelete;
          setConfirmDelete(null);
          if (r) doDelete(r);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <p className="text-text-faint px-1 text-[11px]">작성자: {requesterName} · 제출한 결의서는 사무실 지출 목록에 함께 표시됩니다.</p>
    </div>
  );
}
