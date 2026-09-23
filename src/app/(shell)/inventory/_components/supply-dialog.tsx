"use client";

import { Button } from "@/components/ui/button";
import { createSupply, deleteSupply, updateSupplyQty } from "@/features/inventory/server/supply-actions";
import type { InventorySupply } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { DialogShell, FIELD, Field, FormError, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 소모품 등록·수정 — 품목·제조사/모델·분배위치(감사 N5) + 수량 + 최종확인일 + 확인자(기본 = 로그인한 사람) + 비고.
 * `supply`가 없으면 **새로 등록**(품목ID 필수 — 엑셀 가져오기의 매칭 키), 있으면 수정(품목ID는 못 바꾼다).
 */
export function SupplyDialog({ supply, today, userName, onClose }: { supply?: InventorySupply; today: string; userName: string; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();
  const isNew = !supply;

  async function onSubmit(fd: FormData) {
    const res = isNew
      ? await submit(fd, createSupply, "소모품을 등록했습니다")
      : await submit(fd, updateSupplyQty, "소모품을 저장했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell
      title={isNew ? "소모품 등록" : `소모품 수정 — ${supply.name}`}
      description={isNew ? "품목ID는 엑셀 가져오기의 매칭 키입니다(등록 뒤엔 바꿀 수 없습니다)." : `${supply.itemCode ?? ""} · 지금 ${supply.qty}개`}
      onClose={onClose}
    >
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        {supply ? <input type="hidden" name="id" value={supply.id} /> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isNew ? (
            <Field label="품목ID"><input name="itemCode" required maxLength={32} placeholder="예: SP-001" className={`${FIELD} font-mono uppercase`} /></Field>
          ) : null}
          <Field label="품목" className={isNew ? undefined : "sm:col-span-2"}><input name="name" defaultValue={supply?.name ?? ""} required maxLength={80} className={FIELD} /></Field>
          <Field label="제조사/모델"><input name="makerModel" defaultValue={supply?.makerModel ?? ""} maxLength={120} className={FIELD} /></Field>
          <Field label="분배위치"><input name="location" defaultValue={supply?.location ?? ""} maxLength={120} className={FIELD} /></Field>
          <Field label="수량"><input type="number" name="qty" defaultValue={supply?.qty ?? 0} min={0} step={1} required className={`${FIELD} num`} /></Field>
          <Field label="최종확인"><input type="date" name="checkedOn" defaultValue={today} required max={today} className={FIELD} /></Field>
          <Field label="확인자" className="sm:col-span-2"><input name="checkerName" defaultValue={userName} maxLength={80} className={FIELD} /></Field>
        </div>
        <Field label="비고"><textarea name="note" defaultValue={supply?.note ?? ""} maxLength={500} className={TEXTAREA} /></Field>
        <FormError error={error} />
        <div className="flex items-center justify-end gap-2">
          {supply ? (
            <DeleteRowButton
              id={supply.id}
              action={deleteSupply}
              label={`소모품 삭제 — ${supply.name}`}
              confirm="이 줄을 지웁니다. 되돌릴 수 없습니다(수량 이력도 함께 사라집니다)."
              successMessage="소모품을 지웠습니다"
              onDone={onClose}
            />
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>{isNew ? "등록" : "저장"}</Button>
        </div>
      </form>
    </DialogShell>
  );
}
