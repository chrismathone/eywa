"use client";

import { Button } from "@/components/ui/button";
import { deleteSupply, updateSupplyQty } from "@/features/inventory/server/supply-actions";
import type { InventorySupply } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { DialogShell, FIELD, Field, FormError, TEXTAREA, useSubmit } from "./form-bits";

/** 소모품 수량 수정 — 수량 + 최종확인일 + 확인자(기본 = 로그인한 사람) + 비고. */
export function SupplyDialog({ supply, today, userName, onClose }: { supply: InventorySupply; today: string; userName: string; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, updateSupplyQty, "수량을 저장했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell
      title={`수량 수정 — ${supply.name}`}
      description={`${supply.itemCode ?? ""} ${supply.makerModel ?? ""} · ${supply.location ?? ""} · 지금 ${supply.qty}개`}
      onClose={onClose}
    >
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={supply.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="수량"><input type="number" name="qty" defaultValue={supply.qty} min={0} step={1} required className={`${FIELD} num`} /></Field>
          <Field label="최종확인"><input type="date" name="checkedOn" defaultValue={today} required max={today} className={FIELD} /></Field>
          <Field label="확인자" className="sm:col-span-2"><input name="checkerName" defaultValue={userName} maxLength={80} className={FIELD} /></Field>
        </div>
        <Field label="비고"><textarea name="note" defaultValue={supply.note ?? ""} maxLength={500} className={TEXTAREA} /></Field>
        <FormError error={error} />
        <div className="flex items-center justify-end gap-2">
          <DeleteRowButton
            id={supply.id}
            action={deleteSupply}
            label={`소모품 삭제 — ${supply.name}`}
            confirm="이 줄을 지웁니다. 되돌릴 수 없습니다(수량 이력도 함께 사라집니다)."
            successMessage="소모품을 지웠습니다"
            onDone={onClose}
          />
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>저장</Button>
        </div>
      </form>
    </DialogShell>
  );
}
