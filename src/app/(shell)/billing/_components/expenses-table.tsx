"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Paperclip, Pencil, Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WindowLink } from "@/components/workspace/window-link";
import { ExpenseDialog } from "./expense-dialog";
import { ExpenseReceiptsModal } from "./expense-receipts-modal";
import {
  deleteExpense,
  duplicateExpense,
  toggleExpenseApproval,
} from "@/features/billing/server/expense-actions";
import type {
  ApprovalRole,
  ExpenseRow,
} from "@/features/billing/server/expense-queries";
import { formatMoney } from "@/features/billing/currencies";

const CAT_COLOR: Record<string, PillColor> = {
  인건비: "purple",
  운영비: "blue",
  매입: "amber",
  마케팅: "rose",
  기타: "neutral",
};

// 토글 가능한 결재 역할(작성은 저장 시 자동 — 표시만).
const TOGGLE_ROLES: { role: Exclude<ApprovalRole, "author">; label: string }[] = [
  { role: "director", label: "원장" },
  { role: "ceo", label: "대표" },
  { role: "executor", label: "집행자" },
];

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const [dialog, setDialog] = useState<{ expense: ExpenseRow | null } | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(id: string, fd: FormData, action: (p: undefined, f: FormData) => Promise<unknown>) {
    setBusy(id);
    startTransition(async () => {
      await action(undefined, fd);
      setBusy(null);
    });
  }

  function doDelete(r: ExpenseRow) {
    const fd = new FormData();
    fd.append("id", r.id);
    run(r.id, fd, deleteExpense);
  }

  function handleDuplicate(r: ExpenseRow) {
    const fd = new FormData();
    fd.append("id", r.id);
    run(r.id, fd, duplicateExpense);
  }

  function toggleStage(r: ExpenseRow, role: ApprovalRole, next: boolean) {
    const fd = new FormData();
    fd.append("id", r.id);
    fd.append("role", role);
    fd.append("checked", String(next));
    run(r.id, fd, toggleExpenseApproval);
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
        <DragScrollArea className="bg-card border-line shadow-card rounded-md border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-3 py-2 text-left">일자</th>
                <th className="micro px-3 py-2 text-left">부서명</th>
                <th className="micro px-3 py-2 text-left">성명</th>
                <th className="micro px-3 py-2 text-left">제목</th>
                <th className="micro px-3 py-2 text-left">분류</th>
                <th className="micro px-3 py-2 text-right">총액</th>
                <th className="micro px-2 py-2 text-center">증빙</th>
                <th className="micro px-2 py-2 text-center">작성</th>
                <th className="micro px-2 py-2 text-center">원장</th>
                <th className="micro px-2 py-2 text-center">대표</th>
                <th className="micro px-2 py-2 text-center">집행자</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => {
                const isBusy = busy === r.id;
                const count = r.lineItems?.length ?? 0;
                return (
                  <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                    <td className="num text-text-dim px-3 py-2 text-xs whitespace-nowrap">{r.expenseDate}</td>
                    <td className="text-text-dim px-3 py-2 text-xs whitespace-nowrap">{r.department ?? "—"}</td>
                    <td className="text-text-dim px-3 py-2 text-xs whitespace-nowrap">{r.author ?? "—"}</td>
                    <td className="text-foreground px-3 py-2 text-xs">
                      <WindowLink
                        href={`/billing/expenses/${r.id}`}
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
                    <td className="num text-danger px-3 py-2 text-right text-xs font-medium whitespace-nowrap">{formatMoney(r.amount, r.currency)}</td>
                    {/* 증빙 — 유형 + 첨부 모달 */}
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setReceiptsFor(r)}
                        className="text-text-faint hover:text-foreground focus-visible:ring-primary/50 inline-flex max-w-[88px] items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] focus:outline-none focus-visible:ring-1"
                        title={`증빙자료${r.receiptType ? ` · ${r.receiptType}` : ""}`}
                        aria-label={`${r.title} 증빙자료 ${r.receiptUrls.length > 0 ? `${r.receiptUrls.length}건` : "없음"}`}
                      >
                        <Paperclip className={`size-3.5 shrink-0 ${r.receiptUrls.length > 0 ? "text-blue" : ""}`} />
                        {r.receiptUrls.length > 0 ? (
                          <span className="text-blue num shrink-0">{r.receiptUrls.length}</span>
                        ) : null}
                        {r.receiptType ? <span className="text-text-dim line-clamp-1">{r.receiptType}</span> : null}
                      </button>
                    </td>
                    {/* 작성 — 정적 표시 */}
                    <td className="px-2 py-2 text-center">
                      <StageMark checked={r.approvalChecks.author?.checked ?? false} />
                    </td>
                    {/* 원장/대표/집행자 — 토글 */}
                    {TOGGLE_ROLES.map(({ role, label }) => {
                      const checked = r.approvalChecks[role]?.checked ?? false;
                      return (
                        <td key={role} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => toggleStage(r, role, !checked)}
                            disabled={isBusy}
                            aria-pressed={checked}
                            title={`${label} 결재 — 클릭하면 ${checked ? "해제" : "승인"}`}
                            className="focus-visible:ring-primary/50 inline-flex items-center justify-center rounded-sm focus:outline-none focus-visible:ring-1"
                          >
                            <StageMark checked={checked} interactive />
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleDuplicate(r)}
                          disabled={isBusy}
                          className="text-text-faint hover:text-blue p-1"
                          aria-label="복제"
                          title="이 결의서를 새 결의서로 복제 (날짜·작성자 자동 갱신)"
                        >
                          <Copy className="size-3.5" />
                        </button>
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
                          onClick={() => setConfirmDelete(r)}
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
        </DragScrollArea>
      )}

      {dialog ? (
        <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} />
      ) : null}

      {receiptsFor ? (
        <ExpenseReceiptsModal expense={receiptsFor} onClose={() => setReceiptsFor(null)} />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title="지출결의서 삭제"
        message={
          confirmDelete
            ? `'${confirmDelete.title}' 지출결의서를 삭제합니다. 되돌릴 수 없습니다.`
            : ""
        }
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          const r = confirmDelete;
          setConfirmDelete(null);
          if (r) doDelete(r);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

function StageMark({ checked, interactive }: { checked: boolean; interactive?: boolean }) {
  if (checked) {
    // ⚠️ Tailwind preflight가 svg를 display:block으로 만들어, 버튼 없는 '작성' 셀에선 좌측 정렬돼
    // 헤더 라벨과 어긋난다 → mx-auto로 중앙 정렬(토글 셀의 inline-flex justify-center 안에선 무해).
    return <Check className="text-primary mx-auto size-4" strokeWidth={3} />;
  }
  return <span className={`text-text-faint text-xs ${interactive ? "hover:text-text-dim" : ""}`}>—</span>;
}
