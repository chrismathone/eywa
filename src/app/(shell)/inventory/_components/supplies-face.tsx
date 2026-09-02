"use client";

import { useMemo, useState } from "react";
import { matchesTextQuery } from "@/features/inventory/filter";
import type { InventorySupply } from "@/features/inventory/types";
import { dashIfEmpty, unknownIfEmpty } from "@/features/inventory/unknown-value";
import { ListToolbar } from "./list-toolbar";
import { SortableTable, type Column } from "./sortable-table";
import { SupplyDialog } from "./supply-dialog";
import { useSort } from "./use-sort";

/** 소모품 면 — `품목ID · 품목 · 제조사/모델 · 수량 · 분배위치 · 최종확인 · 확인자`. v1 쓰기는 수량 수정뿐. */
export function SuppliesFace({ supplies, canWrite, today, userName }: { supplies: InventorySupply[]; canWrite: boolean; today: string; userName: string }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<InventorySupply | null>(null);
  const { sort, toggle } = useSort();
  const rows = useMemo(
    () => supplies.filter((s) => matchesTextQuery([s.itemCode, s.name, s.makerModel, s.location, s.checkerName], query)),
    [supplies, query],
  );
  const columns = useMemo((): Column<InventorySupply>[] => [
    { key: "itemCode", label: "품목ID", render: (s) => <span className="font-mono text-[11.5px]">{s.itemCode ?? ""}</span>, className: "whitespace-nowrap" },
    { key: "name", label: "품목", render: (s) => <span className="font-medium">{s.name}</span>, className: "whitespace-nowrap" },
    { key: "makerModel", label: "제조사/모델", render: (s) => (s.makerModel ? s.makerModel : <span className="text-text-faint">{unknownIfEmpty(null)}</span>), className: "whitespace-nowrap" },
    { key: "qty", label: "수량", render: (s) => <span className="num font-bold">{s.qty}</span>, className: "text-right whitespace-nowrap" },
    { key: "location", label: "분배위치", render: (s) => (s.location ? s.location : <span className="text-text-faint">{dashIfEmpty(null)}</span>), className: "whitespace-nowrap" },
    { key: "checkedOn", label: "최종확인", render: (s) => (s.checkedOn ? <span className="num">{s.checkedOn}</span> : <span className="text-text-faint">{unknownIfEmpty(null)}</span>), className: "whitespace-nowrap" },
    { key: "checkerName", label: "확인자", render: (s) => (s.checkerName ? s.checkerName : <span className="text-text-faint">{dashIfEmpty(null)}</span>), className: "whitespace-nowrap" },
  ], []);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar query={query} onQueryChange={setQuery} placeholder="품목, 모델, 위치 검색" summary={`${rows.length}건`} />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          sort={sort}
          onSort={toggle}
          emptyText={supplies.length === 0 ? "등록된 소모품이 없습니다" : "조건에 맞는 소모품이 없습니다"}
          actions={
            canWrite
              ? (s) => (
                  <button type="button" className="text-primary px-1 text-[11.5px] font-medium hover:underline" onClick={() => setEditing(s)}>
                    수량 수정
                  </button>
                )
              : undefined
          }
        />
      </div>
      {editing ? <SupplyDialog supply={editing} today={today} userName={userName} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
