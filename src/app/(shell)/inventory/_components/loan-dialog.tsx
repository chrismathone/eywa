"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { startLoan } from "@/features/inventory/server/loan-actions";
import { assetStatusLabel } from "@/features/inventory/status";
import type { AssetOption } from "@/features/inventory/types";
import { useCategoryMaps } from "./categories-context";
import { DialogShell, FIELD, Field, FormError, SELECT, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 대여 시작 — 자산(폐기·대여중 제외) + 대여자 + 소속 + 대여일 + 반납예정(날짜 또는 '상시').
 * 서버가 열린 대여를 다시 확인한다(부분 유니크가 최후 방어, [[#113]]). 반납예정 '상시'는 날짜 칸이 아니라
 * 표기 칸(due_note)에 들어간다.
 */
export function LoanDialog({ assets, presetAssetId, today, onClose }: { assets: AssetOption[]; presetAssetId?: string; today: string; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();
  const cats = useCategoryMaps();
  const [always, setAlways] = useState(false);
  const candidates = useMemo(() => assets.filter((a) => a.status !== "disposed" && (a.status !== "on_loan" || a.id === presetAssetId)), [assets, presetAssetId]);

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, startLoan, "대여를 기록했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell title="대여 시작" description="자산은 '대여중'이 되고 사용자 칸에 대여자가 적힙니다. 반납하면 대여 전 상태로 되돌아갑니다." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        <Field label="자산">
          <select name="assetId" defaultValue={presetAssetId ?? ""} required disabled={!!presetAssetId} className={SELECT}>
            {!presetAssetId ? <option value="">자산을 고르세요</option> : null}
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.assetCode} · {a.model ?? cats.labelOf(a.category)} · {assetStatusLabel(a.status)}
              </option>
            ))}
          </select>
          {presetAssetId ? <input type="hidden" name="assetId" value={presetAssetId} /> : null}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="대여자"><input name="borrowerName" required maxLength={80} placeholder="이름" className={FIELD} /></Field>
          <Field label="소속"><input name="dept" maxLength={80} placeholder="예: 강사 · 경영지원팀 · 운영" className={FIELD} /></Field>
          <Field label="대여일"><input type="date" name="lentOn" defaultValue={today} required max={today} className={FIELD} /></Field>
          <Field label="반납예정" as="div">
            <div className="flex items-center gap-2">
              <input type="date" name="dueOn" min={today} disabled={always} aria-label="반납예정일" className={FIELD} />
              <label className="text-text-dim flex shrink-0 items-center gap-1 text-[11.5px]">
                <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> 상시
              </label>
            </div>
            {always ? <input type="hidden" name="dueNote" value="상시" /> : null}
          </Field>
        </div>
        <Field label="비고"><textarea name="note" maxLength={500} className={TEXTAREA} /></Field>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>대여 기록</Button>
        </div>
      </form>
    </DialogShell>
  );
}
