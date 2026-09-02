"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { nextAssetCode } from "@/features/inventory/asset-code";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, isAssetCategory, type AssetCategory } from "@/features/inventory/category";
import { createAsset, updateAsset } from "@/features/inventory/server/asset-actions";
import { ASSET_STATUSES, ASSET_STATUS_LABEL } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { DialogShell, FIELD, Field, FormError, SELECT, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 자산 등록·수정 — 자산ID는 분류 접두 + 3자리 **자동 제안**(직접 고칠 수 있다, 중복은 서버가 한글로 거절).
 * 등록 때만 상태를 고른다(대여중 제외 — 대여는 '대여 시작'으로). 수정에서 상태는 '상태' 버튼이 따로 맡는다
 * (폐기일 짝·열린 대여 검사가 그쪽에 있다).
 */
export function AssetDialog({
  mode,
  asset,
  existingCodes,
  today,
  onClose,
}: {
  mode: "create" | "edit";
  asset?: InventoryAsset;
  existingCodes: string[];
  today: string;
  onClose: () => void;
}) {
  const { busy, error, submit } = useSubmit();
  const [category, setCategory] = useState<AssetCategory>(asset && isAssetCategory(asset.category) ? asset.category : "laptop");
  const [code, setCode] = useState(asset?.assetCode ?? nextAssetCode("laptop", existingCodes));
  const [codeTouched, setCodeTouched] = useState(mode === "edit");
  const [status, setStatus] = useState(asset?.status ?? "in_use");

  function onCategory(next: AssetCategory) {
    setCategory(next);
    // 사람이 아직 안 만진 자산ID만 따라 바뀐다(직접 적은 값을 덮지 않는다).
    if (!codeTouched) setCode(nextAssetCode(next, existingCodes));
  }

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, mode === "create" ? createAsset : updateAsset, mode === "create" ? "자산을 등록했습니다" : "자산을 수정했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell title={mode === "create" ? "자산 등록" : `자산 수정 — ${asset?.assetCode ?? ""}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {asset ? <input type="hidden" name="id" value={asset.id} /> : null}
        <Field label="분류">
          <select name="category" value={category} onChange={(e) => onCategory(e.target.value as AssetCategory)} className={SELECT}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Field>
        <Field label="자산ID" hint="분류 접두 + 번호가 자동으로 제안됩니다. 라벨 번호가 다르면 직접 고치세요.">
          <input
            name="assetCode"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }}
            required
            maxLength={32}
            className={`${FIELD} font-mono`}
          />
        </Field>
        <Field label="제조사"><input name="maker" defaultValue={asset?.maker ?? ""} maxLength={80} placeholder="비우면 미기재" className={FIELD} /></Field>
        <Field label="모델명"><input name="model" defaultValue={asset?.model ?? ""} maxLength={120} placeholder="비우면 미기재" className={FIELD} /></Field>
        <Field label="시리얼번호" hint="원본 대장엔 없던 칸 — 다음 실사 때 채우면 됩니다.">
          <input name="serialNo" defaultValue={asset?.serialNo ?? ""} maxLength={120} className={`${FIELD} font-mono`} />
        </Field>
        <Field label="입고일"><input type="date" name="acquiredOn" defaultValue={asset?.acquiredOn ?? ""} max={today} className={FIELD} /></Field>
        <Field label="현위치"><input name="location" defaultValue={asset?.location ?? ""} maxLength={120} placeholder="예: 3층LAB(305)" className={FIELD} /></Field>
        {mode === "create" ? (
          <Field label="상태" hint="대여중은 여기서 고르지 않습니다 — 등록 뒤 '대여'로.">
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
              {ASSET_STATUSES.filter((s) => s !== "on_loan").map((s) => (
                <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
        ) : null}
        {mode === "create" && status === "disposed" ? (
          <Field label="폐기일"><input type="date" name="disposedOn" defaultValue={today} required max={today} className={FIELD} /></Field>
        ) : null}
        <Field label="비고" className="sm:col-span-2">
          <textarea name="note" defaultValue={asset?.note ?? ""} maxLength={500} className={TEXTAREA} />
        </Field>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>{mode === "create" ? "등록" : "저장"}</Button>
        </div>
      </form>
    </DialogShell>
  );
}
