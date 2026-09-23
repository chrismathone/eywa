"use client";

import { useMemo, useState } from "react";
import { ToolbarButton } from "@/components/toolbar";
import { matchesTextQuery } from "@/features/inventory/filter";
import type { InventorySupply } from "@/features/inventory/types";
import { DashCell, UnknownCell } from "./cell-bits";
import { ListToolbar } from "./list-toolbar";
import { SortableTable, type Column } from "./sortable-table";
import { SupplyDialog } from "./supply-dialog";
import { useSort } from "./use-sort";

/** 소모품 면 — `품목ID · 품목 · 제조사/모델 · 수량 · 분배위치 · 최종확인 · 확인자`. 수정은 행 더블클릭, 등록은 '+ 소모품 등록'. */
export function SuppliesFace({ supplies, canWrite, today, userName }: { supplies: InventorySupply[]; canWrite: boolean; today: string; userName: string }) {
  const [query, setQuery] = useState("");
  // "new" = 새로 등록(감사 N5) · 행 = 그 소모품 수정.
  const [editing, setEditing] = useState<InventorySupply | "new" | null>(null);
  const { sort, toggle } = useSort();
  const rows = useMemo(
    () => supplies.filter((s) => matchesTextQuery([s.itemCode, s.name, s.makerModel, s.location, s.checkerName], query)),
    [supplies, query],
  );
  const columns = useMemo((): Column<InventorySupply>[] => [
    { key: "itemCode", label: "품목ID", width: 80, render: (s) => <span className="font-mono text-xs">{s.itemCode ?? ""}</span>, className: "whitespace-nowrap" },
    { key: "name", label: "품목", width: 96, render: (s) => <span className="font-medium">{s.name}</span>, className: "whitespace-nowrap" },
    { key: "makerModel", label: "제조사/모델", minWidth: 160, render: (s) => <UnknownCell v={s.makerModel} />, className: "whitespace-nowrap" },
    { key: "qty", label: "수량", width: 72, render: (s) => <span className="num font-bold">{s.qty}</span>, className: "whitespace-nowrap" },
    { key: "location", label: "분배위치", width: 128, render: (s) => <DashCell v={s.location} />, className: "whitespace-nowrap" },
    { key: "checkedOn", label: "최종확인", width: 100, render: (s) => <UnknownCell v={s.checkedOn} num />, className: "whitespace-nowrap" },
    { key: "checkerName", label: "확인자", width: 88, render: (s) => <DashCell v={s.checkerName} />, className: "whitespace-nowrap" },
  ], []);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="품목, 모델, 위치 검색"
        summary={`${rows.length}건${canWrite ? " · 행 더블클릭 = 수정" : ""}`}
        actions={canWrite ? <ToolbarButton variant="primary" onClick={() => setEditing("new")}>+ 소모품 등록</ToolbarButton> : null}
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          sort={sort}
          onSort={toggle}
          emptyText={supplies.length === 0 ? "등록된 소모품이 없습니다" : "조건에 맞는 소모품이 없습니다"}
          onRowDoubleClick={canWrite ? (s) => setEditing(s) : undefined}
        />
      </div>
      {editing ? (
        <SupplyDialog supply={editing === "new" ? undefined : editing} today={today} userName={userName} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}
