"use client";

import { Button } from "@/components/ui/button";
import { createVendor, deleteVendor, updateVendor } from "@/features/inventory/server/vendor-actions";
import type { InventoryVendor } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { DialogShell, FIELD, Field, FormError, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 업체 등록·수정 — `vendor`가 없으면 새로 등록. 분류는 자유 입력이되 **이미 쓰는 분류를 자동완성**으로 보여 준다
 * (같은 곳이 `서점`·`서점 `·`책방`으로 갈리지 않게 — 코드 목록은 없다).
 * 번호는 숫자만 적어도 저장할 때 하이픈이 들어간다(`formatPhone`).
 */
export function VendorDialog({ vendor, categories, onClose }: { vendor?: InventoryVendor; categories: string[]; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();
  const isNew = !vendor;

  async function onSubmit(fd: FormData) {
    const res = isNew ? await submit(fd, createVendor, "업체를 등록했습니다") : await submit(fd, updateVendor, "업체를 저장했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell title={isNew ? "업체 등록" : `업체 수정 — ${vendor.name}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}
        <p className="text-text-faint text-xs">업체명만 적으면 등록됩니다. 나머지 칸은 비워 둬도 됩니다.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="업체명 (필수)"><input name="name" defaultValue={vendor?.name ?? ""} required maxLength={80} autoFocus={isNew} className={FIELD} /></Field>
          <Field label="분류" hint="예: 서점 · 출판사 · 정수기 · 인테리어">
            <input name="category" list="inventory-vendor-categories" defaultValue={vendor?.category ?? ""} maxLength={40} className={FIELD} />
            <datalist id="inventory-vendor-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="대표전화"><input name="phone" type="tel" inputMode="tel" defaultValue={vendor?.phone ?? ""} maxLength={40} className={`${FIELD} num`} /></Field>
          <Field label="사업자등록번호"><input name="bizNo" inputMode="numeric" defaultValue={vendor?.bizNo ?? ""} maxLength={20} placeholder="000-00-00000" className={`${FIELD} num`} /></Field>
          <Field label="담당자"><input name="contactName" defaultValue={vendor?.contactName ?? ""} maxLength={40} className={FIELD} /></Field>
          <Field label="담당자 연락처"><input name="contactPhone" type="tel" inputMode="tel" defaultValue={vendor?.contactPhone ?? ""} maxLength={40} className={`${FIELD} num`} /></Field>
          <Field label="주소" className="sm:col-span-2"><input name="address" defaultValue={vendor?.address ?? ""} maxLength={200} className={FIELD} /></Field>
          <Field label="이메일" className="sm:col-span-2"><input name="email" type="text" inputMode="email" defaultValue={vendor?.email ?? ""} maxLength={120} className={FIELD} /></Field>
        </div>
        <Field label="비고" hint="계좌·거래 조건·영업시간 등"><textarea name="note" defaultValue={vendor?.note ?? ""} maxLength={500} className={TEXTAREA} /></Field>
        <FormError error={error} />
        <div className="flex items-center justify-end gap-2">
          {vendor ? (
            <DeleteRowButton
              id={vendor.id}
              action={deleteVendor}
              label={`업체 삭제 — ${vendor.name}`}
              confirm="이 업체를 목록에서 지웁니다. 되돌릴 수 없습니다."
              successMessage="업체를 지웠습니다"
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
