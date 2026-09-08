"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { nextAssetCode } from "@/features/inventory/asset-code";
import { createAsset, deleteAsset, updateAsset } from "@/features/inventory/server/asset-actions";
import { ASSET_STATUSES, ASSET_STATUS_LABEL } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { useCategoryMaps } from "./categories-context";
import { DialogShell, FIELD, Field, FormError, SELECT, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 자산 등록·수정 — 자산ID는 분류 접두 + 3자리 **자동 제안**(직접 고칠 수 있다, 중복은 서버가 한글로 거절).
 * 등록 때만 상태를 고른다(대여중 제외 — 대여는 '대여 시작'으로). 수정에서 상태는 '상태' 버튼이 따로 맡는다
 * (폐기일 짝·열린 대여 검사가 그쪽에 있다).
 * 🔑 분류 선택지는 학원별 분류(0247a) — 목록·라벨·접두를 여기 적지 않는다. 새 분류를 만드는 길은 **엑셀**뿐이라
 *    여기 드롭다운엔 등록된 것만 뜬다(원장 2026-09-03 지시 범위 = 엑셀 자동 추가).
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
  const cats = useCategoryMaps();
  // 등록 기본값 = 목록의 두 번째(노트북 자리) — 없으면 첫 번째. 분류가 0개면 빈 값(서버가 한글로 거절한다).
  // 🔴 수정할 때 그 자산의 분류가 목록에 없어도(조회 실패 폴백) **그 값을 지키고** 선택지에 남긴다 —
  //    조용히 '노트북'으로 바꿔 두면 저장 한 번에 분류가 바뀐다.
  const unknownCurrent = mode === "edit" && !!asset && !cats.has(asset.category) ? asset.category : null;
  const initialCategory = unknownCurrent ?? (asset && cats.has(asset.category) ? asset.category : (cats.list[1]?.key ?? cats.list[0]?.key ?? ""));
  const [category, setCategory] = useState(initialCategory);
  const [code, setCode] = useState(asset?.assetCode ?? nextAssetCode(cats.prefixOf(initialCategory), existingCodes));
  const [codeTouched, setCodeTouched] = useState(mode === "edit");
  const [status, setStatus] = useState(asset?.status ?? "in_use");

  function onCategory(next: string) {
    setCategory(next);
    // 사람이 아직 안 만진 자산ID만 따라 바뀐다(직접 적은 값을 덮지 않는다).
    if (!codeTouched) setCode(nextAssetCode(cats.prefixOf(next), existingCodes));
  }

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, mode === "create" ? createAsset : updateAsset, mode === "create" ? "자산을 등록했습니다" : "자산을 수정했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell title={mode === "create" ? "자산 등록" : `자산 수정 — ${asset?.assetCode ?? ""}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {asset ? <input type="hidden" name="id" value={asset.id} /> : null}
        <Field
          label="분류"
          hint={
            cats.list.length === 0
              ? "등록된 분류가 없습니다 — 엑셀로 넣거나 관리자에게 문의하세요."
              : unknownCurrent
                ? "이 자산의 분류를 목록에서 못 찾았습니다 — 지금 값을 그대로 둡니다."
                : undefined
          }
        >
          <select name="category" value={category} onChange={(e) => onCategory(e.target.value)} required className={SELECT}>
            {cats.list.length === 0 && !unknownCurrent ? <option value="">분류가 없습니다</option> : null}
            {unknownCurrent ? <option value={unknownCurrent}>{cats.labelOf(unknownCurrent)}</option> : null}
            {cats.options.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
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
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {mode === "edit" && asset ? (
            <DeleteRowButton
              id={asset.id}
              action={deleteAsset}
              label={`자산 삭제 — ${asset.assetCode}`}
              confirm="이 자산과 함께 그 자산의 대여·실사 이력이 모두 지워집니다. 되돌릴 수 없습니다. (대여 중인 자산은 반납 처리 후에 지울 수 있습니다)"
              successMessage="자산을 지웠습니다"
              onDone={onClose}
            />
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>{mode === "create" ? "등록" : "저장"}</Button>
        </div>
      </form>
    </DialogShell>
  );
}
