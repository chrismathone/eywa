"use client";

import { useMemo, useState } from "react";
import { ToolbarButton, ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { assetFilterChips, filterAssets, type AssetFilterKey } from "@/features/inventory/filter";
import { saveInventoryPrefs } from "@/features/inventory/server/prefs";
import { needsAction } from "@/features/inventory/status";
import { holderEditBlockReason, loanMismatchMap } from "@/features/inventory/loan-link";
import type { InventoryAsset, InventoryLoan } from "@/features/inventory/types";
import { assetColumns } from "./asset-columns";
import { AssetDialog } from "./asset-dialog";
import { useCategoryMaps } from "./categories-context";
import { ExcelDialog } from "./excel-dialog";
import { HolderDialog } from "./holder-dialog";
import { ListToolbar } from "./list-toolbar";
import { QrDialog } from "./qr-dialog";
import { SortableTable } from "./sortable-table";
import { StatusDialog } from "./status-dialog";
import { useSort } from "./use-sort";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; asset: InventoryAsset }
  | { kind: "status"; asset: InventoryAsset }
  | { kind: "holder"; asset: InventoryAsset; blockedReason: string | null }
  | { kind: "qr"; asset: InventoryAsset }
  | { kind: "excel" }
  | null;

/**
 * 자산 마스터 면 — 검색 + 필터 칩(단일 선택, 시안 순서) + 전 열 정렬. 전부 **클라 필터**다(96행 전건을
 * 서버가 한 번에 내려준다 — searchParam 네비면 필터 전환마다 스켈레톤이 번쩍인다, B7 트레이드오프).
 *
 * 쓰기 진입(원장 2026-09-02 *"우측 제거 · 상태 더블클릭시 변경 · 수정도 행 더블클릭시"*): 행 더블클릭 = 수정,
 * 상태 칸 더블클릭 = 상태 변경. 우측 동작 열은 없다. 대여 시작·실사 기록은 각 면(대여·실사)의 버튼에서.
 * 툴바 우측 = [엑셀](서식 내려받기·올리기) · [인쇄](QR 라벨 시트) · [+ 자산 등록]. QR 열의 [보기]는 열람만으로도 된다.
 * 서버 액션이 **같은 게이트**를 다시 지나므로 `canWrite`는 진입로만 정한다.
 */
export function AssetsFace({
  assets,
  loans,
  canWrite,
  today,
  hideDisposed: hideDisposedInitial,
}: {
  assets: InventoryAsset[];
  /** 대여 기록 — **null이면 판정하지 않는다**(조회 실패를 '어긋남'으로 읽지 않게, page.tsx 주석). */
  loans: InventoryLoan[] | null;
  canWrite: boolean;
  today: string;
  /** 저장된 보기 설정(users.ui_prefs.inventory) — 토글은 바꾸는 순간 저장한다([[#90]]). */
  hideDisposed: boolean;
}) {
  const cats = useCategoryMaps();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<AssetFilterKey>("all");
  const [hideDisposed, setHideDisposed] = useState(hideDisposedInitial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const { sort, toggle } = useSort();
  const chips = useMemo(() => assetFilterChips(assets, cats.list), [assets, cats]);
  // 장부와 어긋난 자산(열린 대여가 없는데 '대여중') — 판정·맞출 값은 순수 규약 한 곳에서.
  const mismatches = useMemo(
    () => (loans ? loanMismatchMap(assets, loans) : new Map()),
    [assets, loans],
  );
  const loansByAsset = useMemo(() => {
    const m = new Map<string, InventoryLoan[]>();
    for (const l of loans ?? []) m.set(l.assetId, [...(m.get(l.assetId) ?? []), l]);
    return m;
  }, [loans]);
  // 폐기 숨김(원장 2026-09-02) — '폐기' 칩을 고른 동안은 토글과 무관하게 보인다(숨긴 채 폐기 필터가 빈 표면 "왜 없지").
  const rows = useMemo(() => {
    const base = filterAssets(assets, chip, query);
    return hideDisposed && chip !== "disposed" ? base.filter((a) => a.status !== "disposed") : base;
  }, [assets, chip, query, hideDisposed]);
  function toggleHideDisposed() {
    const next = !hideDisposed;
    setHideDisposed(next);
    void saveInventoryPrefs({ hideDisposed: next });
  }
  // 고정 번호(No) — 마스터 순서(서버 정렬 = sort_order·자산ID)로 1부터. 필터·정렬해도 그 자산의 번호는 그대로.
  const noById = useMemo(() => new Map(assets.map((a, i) => [a.id, i + 1])), [assets]);
  const columns = useMemo(
    () =>
      assetColumns(cats, {
        noOf: (asset) => noById.get(asset.id) ?? null,
        onStatusDoubleClick: canWrite ? (asset) => setDialog({ kind: "status", asset }) : undefined,
        // 사용자 칸 더블클릭 = 사용자 지정(원장 2026-09-08). 대여 중이면 창이 안내로 바뀐다.
        onHolderDoubleClick: canWrite
          ? (asset) =>
              setDialog({
                kind: "holder",
                asset,
                blockedReason: loans
                  ? holderEditBlockReason(asset, loansByAsset.get(asset.id) ?? [])
                  : null,
              })
          : undefined,
        mismatchOf: (asset) => mismatches.get(asset.id) ?? null,
        onQrClick: (asset) => setDialog({ kind: "qr", asset }),
      }),
    [canWrite, noById, cats, loans, loansByAsset, mismatches],
  );
  const existingCodes = useMemo(() => assets.map((a) => a.assetCode), [assets]);
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
        extra={
          <ToolbarChip active={hideDisposed} onClick={toggleHideDisposed} title="폐기 자산을 표에서 감춥니다('폐기' 필터를 고르면 보입니다)">
            폐기 숨김
          </ToolbarChip>
        }
        summary={`${rows.length}건${canWrite ? " · 행 더블클릭 = 수정 · 상태·사용자 칸 더블클릭 = 그 칸만 변경" : ""}`}
        actions={
          <>
            {canWrite ? <ToolbarButton onClick={() => setDialog({ kind: "excel" })}>엑셀</ToolbarButton> : null}
            <PrintWindowButton id="print/inventory-qr" href="/inventory/qr/print" title="자산 QR 라벨 인쇄" variant="outline" className="h-8 rounded-lg px-2.5 text-xs">
              인쇄
            </PrintWindowButton>
            {canWrite ? <ToolbarButton variant="primary" onClick={() => setDialog({ kind: "create" })}>+ 자산 등록</ToolbarButton> : null}
          </>
        }
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          sort={sort}
          onSort={toggle}
          emptyText={assets.length === 0 ? "등록된 자산이 없습니다" : "조건에 맞는 자산이 없습니다"}
          onRowDoubleClick={canWrite ? (asset) => setDialog({ kind: "edit", asset }) : undefined}
          // 조치필요 행 = 붉은 틴트(원장 2026-09-02). 🔴 판정은 스탯·칩·조치 목록과 **같은 `needsAction`** — 상태가 바뀌면 색도 따라간다.
          rowClassName={(asset) => (needsAction(asset.status) ? "bg-danger/15 hover:bg-danger/25" : "")}
        />
      </div>

      {dialog?.kind === "create" ? <AssetDialog mode="create" existingCodes={existingCodes} today={today} onClose={close} /> : null}
      {dialog?.kind === "edit" ? <AssetDialog mode="edit" asset={dialog.asset} existingCodes={existingCodes} today={today} onClose={close} /> : null}
      {dialog?.kind === "status" ? (
        <StatusDialog
          asset={dialog.asset}
          today={today}
          mismatch={mismatches.get(dialog.asset.id) ?? null}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "holder" ? (
        <HolderDialog asset={dialog.asset} blockedReason={dialog.blockedReason} onClose={close} />
      ) : null}
      {dialog?.kind === "qr" ? <QrDialog asset={dialog.asset} onClose={close} /> : null}
      {dialog?.kind === "excel" ? <ExcelDialog onClose={close} /> : null}
    </section>
  );
}
