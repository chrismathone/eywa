"use client";

import { useMemo, useState } from "react";
import { ToolbarButton, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { assetFilterChips, filterAssets, type AssetFilterKey } from "@/features/inventory/filter";
import type { AssetOption, InventoryAsset } from "@/features/inventory/types";
import { assetColumns } from "./asset-columns";
import { AssetDialog } from "./asset-dialog";
import { AuditDialog } from "./audit-dialog";
import { ListToolbar } from "./list-toolbar";
import { LoanDialog } from "./loan-dialog";
import { SortableTable } from "./sortable-table";
import { StatusDialog } from "./status-dialog";
import { useSort } from "./use-sort";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; asset: InventoryAsset }
  | { kind: "status"; asset: InventoryAsset }
  | { kind: "loan"; asset: InventoryAsset }
  | { kind: "audit"; asset: InventoryAsset }
  | null;

const ROW_BTN = "text-primary hover:underline px-1 text-[11.5px] font-medium";

/**
 * 자산 마스터 면 — 검색 + 필터 칩(단일 선택, 시안 순서) + 전 열 정렬. 전부 **클라 필터**다(96행 전건을
 * 서버가 한 번에 내려준다 — searchParam 네비면 필터 전환마다 스켈레톤이 번쩍인다, B7 트레이드오프).
 * 쓰기 동작(등록·수정·상태·대여·실사)은 `canWrite`일 때만 그려지고, 서버 액션이 **같은 게이트**를 다시 지난다.
 */
export function AssetsFace({ assets, canWrite, today }: { assets: InventoryAsset[]; canWrite: boolean; today: string }) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<AssetFilterKey>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const { sort, toggle } = useSort();
  const chips = useMemo(() => assetFilterChips(assets), [assets]);
  const rows = useMemo(() => filterAssets(assets, chip, query), [assets, chip, query]);
  const columns = useMemo(() => assetColumns(), []);
  const existingCodes = useMemo(() => assets.map((a) => a.assetCode), [assets]);
  const options: AssetOption[] = useMemo(
    () => assets.map((a) => ({ id: a.id, assetCode: a.assetCode, category: a.category, model: a.model, status: a.status, location: a.location })),
    [assets],
  );
  const close = () => setDialog(null);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="자산ID, 모델명, 위치, 사용자 검색"
        filters={
          <ToolbarSegment wrap title="필터 — 하나만 고릅니다">
            {chips.map((c) => (
              <ToolbarSegmentItem key={c.key} active={chip === c.key} onClick={() => setChip(c.key)}>
                {c.label}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        }
        summary={`${rows.length}건`}
        actions={canWrite ? <ToolbarButton variant="primary" onClick={() => setDialog({ kind: "create" })}>+ 자산 등록</ToolbarButton> : null}
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          sort={sort}
          onSort={toggle}
          emptyText={assets.length === 0 ? "등록된 자산이 없습니다" : "조건에 맞는 자산이 없습니다"}
          actions={
            canWrite
              ? (a) => (
                  <span className="inline-flex flex-wrap gap-0.5">
                    <button type="button" className={ROW_BTN} onClick={() => setDialog({ kind: "edit", asset: a })}>수정</button>
                    <button type="button" className={ROW_BTN} onClick={() => setDialog({ kind: "status", asset: a })}>상태</button>
                    {a.status !== "disposed" && a.status !== "on_loan" ? (
                      <button type="button" className={ROW_BTN} onClick={() => setDialog({ kind: "loan", asset: a })}>대여</button>
                    ) : null}
                    {a.status !== "disposed" ? (
                      <button type="button" className={ROW_BTN} onClick={() => setDialog({ kind: "audit", asset: a })}>실사</button>
                    ) : null}
                  </span>
                )
              : undefined
          }
        />
      </div>

      {dialog?.kind === "create" ? <AssetDialog mode="create" existingCodes={existingCodes} today={today} onClose={close} /> : null}
      {dialog?.kind === "edit" ? <AssetDialog mode="edit" asset={dialog.asset} existingCodes={existingCodes} today={today} onClose={close} /> : null}
      {dialog?.kind === "status" ? <StatusDialog asset={dialog.asset} today={today} onClose={close} /> : null}
      {dialog?.kind === "loan" ? <LoanDialog assets={options} presetAssetId={dialog.asset.id} today={today} onClose={close} /> : null}
      {dialog?.kind === "audit" ? <AuditDialog assets={options} presetAssetId={dialog.asset.id} today={today} onClose={close} /> : null}
    </section>
  );
}
