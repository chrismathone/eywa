"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Paperclip, Pencil, Plus, Receipt, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WindowLink } from "@/components/workspace/window-link";
import { ExpenseDialog } from "@/app/(shell)/billing/_components/expense-dialog";
import { ExpenseReceiptsModal } from "@/app/(shell)/billing/_components/expense-receipts-modal";
import { deleteExpense } from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";
import { formatMoney } from "@/features/billing/currencies";
import { writeLockedPlaceholder } from "@/lib/write-lock";

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
/**
 * 색은 의미색 캐논(src/lib/design/semantic-color.ts) — 제출됨=inert → 결재중=info → 결재완료=positive.
 * ⚠️ 결재완료는 v4에서 primary(네이비) → positive(그린): 전자결재 '승인'과 같은 뜻인데 색이 달랐다.
 *    결재중도 amber(=내 차례)가 아니라 info다 — 강사에게 이건 **사무실이 처리 중**이라는 정보다.
 */
function statusLabel(r: ExpenseRow): { label: string; color: PillColor } {
  if (r.approvalStatus === "approved") return { label: "결재완료", color: toneColor("positive") };
  if (isLocked(r)) return { label: "결재중", color: toneColor("info") };
  return { label: "제출됨", color: toneColor("inert") };
}

export function ExpenseRequestsClient({
  rows,
  requesterName,
  canWrite,
}: {
  rows: ExpenseRow[];
  requesterName: string;
  /** 서버 게이트(expenseWriteScope)와 같은 판정 — false면 작성·수정·삭제·증빙 변경 단추를 그리지 않는다. */
  canWrite: boolean;
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
    <div className="w-full min-w-0 space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="text-primary size-5" />
          <div>
            <h1 className="text-foreground text-xl font-bold">지출결의서</h1>
            <p className="text-text-dim text-sm">
              지출 내역을 작성해 제출하면 사무실에서 원장·대표 결재 후 처리합니다. 본인이 작성한 결의서만 표시됩니다.
            </p>
          </div>
        </div>
        {canWrite ? (
          <Button onClick={() => setDialog({ expense: null })}>
            <Plus className="size-4" />새 지출결의서
          </Button>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-2xl border border-dashed px-4 py-12 text-center text-sm">
          {canWrite
            ? "제출한 지출결의서가 없습니다. 위 “새 지출결의서”로 작성하세요."
            : `제출한 지출결의서가 없습니다. 작성하려면 ${writeLockedPlaceholder("expense_requests")}`}
        </div>
      ) : (
        <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
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
                        className="text-text-faint hover:text-foreground focus-visible:ring-primary/50 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs focus:outline-none focus-visible:ring-1"
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
                        {!canWrite ? null : locked ? (
                          <span className="text-text-faint px-1 text-xs" title="사무실 결재가 시작되어 수정할 수 없습니다">
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

      {canWrite && dialog ? <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} /> : null}

      {receiptsFor ? (
        // 증빙 열람은 누구나, 바꾸기는 쓰기 권한이 있을 때만(결재 착수 후 잠금은 서버 guardOwnExpense가 따로 막는다).
        <ExpenseReceiptsModal
          expense={receiptsFor}
          onClose={() => setReceiptsFor(null)}
          canEdit={canWrite}
          lockedMenu="expense_requests"
        />
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

      <p className="text-text-faint px-1 text-xs">작성자: {requesterName} · 제출한 결의서는 사무실 지출 목록에 함께 표시됩니다.</p>
    </div>
  );
}
