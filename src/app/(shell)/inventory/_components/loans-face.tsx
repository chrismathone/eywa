"use client";

import { useMemo, useState } from "react";
import { ToolbarButton } from "@/components/toolbar";
import { matchesTextQuery } from "@/features/inventory/filter";
import { loanStatusLabel } from "@/features/inventory/loan-status";
import type { AssetOption, InventoryLoan } from "@/features/inventory/types";
import { DashCell, UnknownCell } from "./cell-bits";
import { ListToolbar } from "./list-toolbar";
import { LoanDialog } from "./loan-dialog";
import { LoanEditDialog } from "./loan-edit-dialog";
import { ReturnDialog } from "./return-dialog";
import { SortableTable, type Column } from "./sortable-table";
import { LoanStatusPill } from "@/features/inventory/components/status-pill";
import { useSort } from "./use-sort";

// 행 더블클릭 = 수정(원장 2026-09-08 *"대여자는 어디서 수정함?"*) — 자산 표와 같은 진입 방식이다.
type Dialog =
  | { kind: "start" }
  | { kind: "return"; loan: InventoryLoan }
  | { kind: "edit"; loan: InventoryLoan }
  | null;

/** 대여이력 면 — `이력ID · 자산ID · 대여자 · 소속 · 대여일 · 반납예정 · 반납일 · 상태 · 비고`. 대여중 행에만 '반납'. */
export function LoansFace({ loans, assets, canWrite, today }: { loans: InventoryLoan[]; assets: AssetOption[]; canWrite: boolean; today: string }) {
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const { sort, toggle } = useSort();
  const rows = useMemo(
    () => loans.filter((l) => matchesTextQuery([l.loanCode, l.assetCode, l.assetModel, l.borrowerName, l.dept, l.note], query)),
    [loans, query],
  );
  const columns = useMemo((): Column<InventoryLoan>[] => [
    { key: "loanCode", label: "이력ID", width: 84, render: (l) => <span className="font-mono text-xs">{l.loanCode}</span>, className: "whitespace-nowrap" },
    { key: "assetCode", label: "자산ID", width: 88, render: (l) => <span className="font-mono text-xs font-bold">{l.assetCode}</span>, className: "whitespace-nowrap" },
    { key: "borrowerName", label: "대여자", width: 96, render: (l) => l.borrowerName, className: "whitespace-nowrap" },
    { key: "dept", label: "소속", width: 100, render: (l) => <DashCell v={l.dept} />, className: "whitespace-nowrap" },
    { key: "lentOn", label: "대여일", width: 100, render: (l) => <UnknownCell v={l.lentOn} num />, className: "whitespace-nowrap" },
    {
      key: "dueOn", label: "반납예정", width: 100,
      render: (l) => (l.dueOn ? <span className="num">{l.dueOn}</span> : <UnknownCell v={l.dueNote} />),
      sortValue: (l) => l.dueOn ?? l.dueNote, className: "whitespace-nowrap",
    },
    { key: "returnedOn", label: "반납일", width: 100, render: (l) => <DashCell v={l.returnedOn} num />, className: "whitespace-nowrap" },
    { key: "status", label: "상태", width: 92, render: (l) => <LoanStatusPill status={l.status} />, sortValue: (l) => loanStatusLabel(l.status), className: "whitespace-nowrap" },
    { key: "note", label: "비고", minWidth: 160, render: (l) => <span className="text-text-dim" title={l.note ?? undefined}>{l.note ?? ""}</span>, className: "whitespace-nowrap" },
  ], []);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="이력ID, 자산ID, 대여자 검색"
        summary={`${rows.length}건${canWrite ? " · 행 더블클릭 = 수정·삭제" : ""}`}
        actions={canWrite ? <ToolbarButton variant="primary" onClick={() => setDialog({ kind: "start" })}>+ 대여 시작</ToolbarButton> : null}
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          sort={sort}
          onSort={toggle}
          emptyText={loans.length === 0 ? "대여 이력이 없습니다" : "조건에 맞는 이력이 없습니다"}
          onRowDoubleClick={canWrite ? (l) => setDialog({ kind: "edit", loan: l }) : undefined}
          actions={
            canWrite
              ? (l) =>
                  l.status === "out" ? (
                    <button type="button" className="text-primary px-1 text-xs font-medium hover:underline" onClick={() => setDialog({ kind: "return", loan: l })}>
                      반납
                    </button>
                  ) : null
              : undefined
          }
        />
      </div>
      {dialog?.kind === "start" ? <LoanDialog assets={assets} today={today} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <LoanEditDialog loan={dialog.loan} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "return" ? <ReturnDialog loan={dialog.loan} today={today} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}
