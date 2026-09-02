"use client";

import { useMemo, useState } from "react";
import { ToolbarButton } from "@/components/toolbar";
import { auditResultLabel } from "@/features/inventory/audit-result";
import { matchesTextQuery } from "@/features/inventory/filter";
import type { AssetOption, InventoryAudit } from "@/features/inventory/types";
import { AuditDialog } from "./audit-dialog";
import { DashCell } from "./cell-bits";
import { ListToolbar } from "./list-toolbar";
import { SortableTable, type Column } from "./sortable-table";
import { AuditResultPill } from "./status-pill";
import { useSort } from "./use-sort";

/** 실사이력 면 — `실사ID · 자산ID · 실사일 · 결과 · 확인위치 · 확인자 · 조치`. */
export function AuditsFace({ audits, assets, canWrite, today }: { audits: InventoryAudit[]; assets: AssetOption[]; canWrite: boolean; today: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { sort, toggle } = useSort();
  const rows = useMemo(
    () => audits.filter((d) => matchesTextQuery([d.auditCode, d.assetCode, d.assetModel, d.location, d.auditorName, d.action], query)),
    [audits, query],
  );
  const columns = useMemo((): Column<InventoryAudit>[] => [
    { key: "auditCode", label: "실사ID", width: 110, render: (d) => <span className="font-mono text-[11.5px]">{d.auditCode}</span>, className: "whitespace-nowrap" },
    { key: "assetCode", label: "자산ID", width: 88, render: (d) => <span className="font-mono text-[11.5px] font-bold">{d.assetCode}</span>, className: "whitespace-nowrap" },
    { key: "auditedOn", label: "실사일", width: 100, render: (d) => <span className="num">{d.auditedOn}</span>, className: "whitespace-nowrap" },
    { key: "result", label: "결과", width: 84, render: (d) => <AuditResultPill result={d.result} />, sortValue: (d) => auditResultLabel(d.result), className: "whitespace-nowrap" },
    { key: "location", label: "확인위치", width: 128, render: (d) => <DashCell v={d.location} />, className: "whitespace-nowrap" },
    { key: "auditorName", label: "확인자", width: 88, render: (d) => <DashCell v={d.auditorName} />, className: "whitespace-nowrap" },
    { key: "action", label: "조치", minWidth: 160, render: (d) => (d.action ? <span className="text-text-dim" title={d.action}>{d.action}</span> : <DashCell v={null} />), className: "whitespace-nowrap" },
  ], []);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="실사ID, 자산ID, 확인자 검색"
        summary={`${rows.length}건`}
        actions={canWrite ? <ToolbarButton variant="primary" onClick={() => setOpen(true)}>+ 실사 기록</ToolbarButton> : null}
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          sort={sort}
          onSort={toggle}
          emptyText={audits.length === 0 ? "실사 이력이 없습니다" : "조건에 맞는 이력이 없습니다"}
        />
      </div>
      {open ? <AuditDialog assets={assets} today={today} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
