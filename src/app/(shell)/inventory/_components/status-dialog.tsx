"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setAssetStatus } from "@/features/inventory/server/asset-actions";
import { ASSET_STATUSES, ASSET_STATUS_LABEL, assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { DialogShell, FIELD, Field, FormError, SELECT, useSubmit } from "./form-bits";

/**
 * 상태 변경 — 폐기로 바꾸면 폐기일을 함께 받는다. 대여중은 목록에 없다(대여 시작으로만).
 * 열린 대여가 있는 자산은 서버가 "반납 먼저"로 거절한다.
 */
export function StatusDialog({
  asset,
  today,
  initialStatus,
  onClose,
}: {
  asset: Pick<InventoryAsset, "id" | "assetCode" | "status" | "disposedOn">;
  today: string;
  initialStatus?: string;
  onClose: () => void;
}) {
  const { busy, error, submit } = useSubmit();
  const [status, setStatus] = useState(initialStatus ?? (asset.status === "on_loan" ? "in_use" : asset.status));

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, setAssetStatus, "상태를 바꿨습니다");
    if (res) onClose();
  }

  return (
    <DialogShell title={`상태 변경 — ${asset.assetCode}`} description={`지금 ${assetStatusLabel(asset.status)}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={asset.id} />
        <Field label="바꿀 상태" hint={asset.status === "on_loan" ? "대여 중인 자산은 대여 면에서 반납 처리하면 자동으로 되돌아옵니다." : "대여중으로 바꾸려면 '대여'를 쓰세요."}>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
            {ASSET_STATUSES.filter((s) => s !== "on_loan").map((s) => (
              <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        {status === "disposed" ? (
          <Field label="폐기일" hint="폐기해도 행은 지우지 않습니다(이력 보존). 스탯 '전체 자산'에서만 빠집니다.">
            <input type="date" name="disposedOn" defaultValue={asset.disposedOn ?? today} required max={today} className={FIELD} />
          </Field>
        ) : null}
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>바꾸기</Button>
        </div>
      </form>
    </DialogShell>
  );
}
