"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { ExpenseDialog } from "./expense-dialog";
import { deleteExpense, setExpenseApproval } from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;
const CAT_COLOR: Record<string, PillColor> = {
  인건비: "purple",
  운영비: "blue",
  매입: "amber",
  마케팅: "rose",
  기타: "neutral",
};

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const [dialog, setDialog] = useState<{ expense: ExpenseRow | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDelete(r: ExpenseRow) {
    if (!confirm(`"${r.title}" 지출을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const fd = new FormData();
    fd.append("id", r.id);
    setBusy(r.id);
    startTransition(async () => {
      await deleteExpense(undefined, fd);
      setBusy(null);
    });
  }

  function toggleApproval(r: ExpenseRow) {
    const fd = new FormData();
    fd.append("id", r.id);
    fd.append("approvalStatus", r.approvalStatus === "approved" ? "pending" : "approved");
    setBusy(r.id);
    startTransition(async () => {
      await setExpenseApproval(undefined, fd);
      setBusy(null);
    });
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setDialog({ expense: null })}>
          <Plus className="size-4" />
          지출 등록
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-md border border-dashed px-4 py-10 text-center text-sm">
          이 달 지출 내역이 없습니다. 위 “지출 등록”으로 추가하세요.
        </div>
      ) : (
      <div className="bg-card border-line shadow-card overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-4 py-2 text-left">지출일</th>
              <th className="micro px-4 py-2 text-left">항목</th>
              <th className="micro px-4 py-2 text-left">분류</th>
              <th className="micro px-4 py-2 text-left">거래처</th>
              <th className="micro px-4 py-2 text-left">승인</th>
              <th className="micro px-4 py-2 text-right">금액</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((r) => {
              const isBusy = busy === r.id;
              const approved = r.approvalStatus === "approved";
              return (
                <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                  <td className="num text-text-dim px-4 py-2 text-xs">{r.expenseDate}</td>
                  <td className="text-foreground px-4 py-2 text-xs">
                    {r.title}
                    {r.author ? <span className="text-text-faint"> · {r.author}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <Pill color={CAT_COLOR[r.category] ?? "neutral"}>{r.category}</Pill>
                  </td>
                  <td className="text-text-dim px-4 py-2 text-xs">{r.vendor ?? "—"}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleApproval(r)}
                      disabled={isBusy}
                      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] transition ${
                        approved
                          ? "border-primary/30 bg-primary-soft text-primary"
                          : "border-line text-text-faint hover:text-foreground hover:bg-bg-soft"
                      }`}
                      title={approved ? "승인됨 — 클릭하면 대기로" : "대기 — 클릭하면 승인"}
                    >
                      {approved ? <Check className="size-3" /> : null}
                      {approved ? "승인" : "대기"}
                    </button>
                  </td>
                  <td className="num text-danger px-4 py-2 text-right text-xs font-medium">{won(r.amount)}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDialog({ expense: r })}
                        disabled={isBusy}
                        className="text-text-faint hover:text-foreground p-1"
                        aria-label="수정"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        disabled={isBusy}
                        className="text-text-faint hover:text-danger p-1"
                        aria-label="삭제"
                      >
                        {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {dialog ? (
        <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
