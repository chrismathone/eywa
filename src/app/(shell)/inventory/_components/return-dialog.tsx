"use client";

import { Button } from "@/components/ui/button";
import { returnLoan } from "@/features/inventory/server/loan-actions";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryLoan } from "@/features/inventory/types";
import { DialogShell, FIELD, Field, FormError, useSubmit } from "./form-bits";

/** 반납 — 반납일 하나. 자산은 대여 전 상태(`prevStatus`, 없으면 사용중)로 되돌아간다(서버가 정한다). */
export function ReturnDialog({ loan, today, onClose }: { loan: InventoryLoan; today: string; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();
  const restored = loan.prevStatus && loan.prevStatus !== "on_loan" && loan.prevStatus !== "disposed" ? loan.prevStatus : "in_use";

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, returnLoan, "반납을 기록했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell
      title={`반납 — ${loan.assetCode}`}
      description={`${loan.borrowerName}${loan.dept ? `(${loan.dept})` : ""} · 대여일 ${loan.lentOn ?? "미기재"} · 반납하면 자산은 '${assetStatusLabel(restored)}'으로 돌아갑니다.`}
      onClose={onClose}
    >
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        <input type="hidden" name="loanId" value={loan.id} />
        <Field label="반납일">
          <input type="date" name="returnedOn" defaultValue={today} required min={loan.lentOn ?? undefined} max={today} className={FIELD} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>반납 기록</Button>
        </div>
      </form>
    </DialogShell>
  );
}
