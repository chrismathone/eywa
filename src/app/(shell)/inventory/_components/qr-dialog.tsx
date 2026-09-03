"use client";

import { Button } from "@/components/ui/button";
import { assetCategoryLabel } from "@/features/inventory/category";
import { qrImageSrc } from "@/features/inventory/qr";
import type { InventoryAsset } from "@/features/inventory/types";
import { DialogShell } from "./form-bits";

/** 자산 한 대의 QR — 표의 [보기]에서. 찍으면 상세(현재 상태) 화면으로 간다. 설명 글은 없다(원장 2026-09-02). */
export function QrDialog({ asset, onClose }: { asset: InventoryAsset; onClose: () => void }) {
  return (
    <DialogShell title={`QR — ${asset.assetCode}`} description={`${assetCategoryLabel(asset.category)} · ${asset.model ?? "모델 미기재"}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- 라우트가 그 자리에서 그리는 SVG */}
        <img src={qrImageSrc(asset.assetCode)} alt={`${asset.assetCode} QR`} width={224} height={224} className="border-line rounded-lg border bg-white p-2" />
        <p className="font-mono text-base font-bold">{asset.assetCode}</p>
        <div className="flex justify-end gap-2 self-stretch">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </DialogShell>
  );
}
