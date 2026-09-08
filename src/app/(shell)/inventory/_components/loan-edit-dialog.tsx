"use client";

import { Button } from "@/components/ui/button";
import { deleteLoan, updateLoan } from "@/features/inventory/server/loan-actions";
import { loanStatusLabel } from "@/features/inventory/loan-status";
import type { InventoryLoan } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { DialogShell, FIELD, Field, FormError, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 대여 기록 수정·삭제 — 대여 면의 행 더블클릭(원장 2026-09-08 *"대여자는 어디서 수정함?"* ·
 * *"더블클릭했을때 삭제 할 수 있도록 우하단 버튼 마련"*).
 *
 * 🔴 **상태는 여기서 안 바꾼다** — 대여중↔반납은 자산 상태까지 함께 옮기는 일이라 [반납] 버튼이 맡고,
 *    어긋난 기록은 자산 면의 [맞추기]가 맡는다. 이 폼에 상태 드롭다운을 넣으면 두 표가 갈린다.
 * 🔑 **열린 대여의 대여자를 고치면 자산의 '사용자'도 함께 바뀐다**(서버가 한다) — 그래서 자산 표에서
 *    같은 사람이 보인다.
 */
export function LoanEditDialog({
  loan,
  onClose,
}: {
  loan: InventoryLoan;
  onClose: () => void;
}) {
  const { busy, error, submit } = useSubmit();

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, updateLoan, "대여 기록을 수정했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell
      title={`대여 수정 — ${loan.loanCode}`}
      description={`${loan.assetCode}${loan.assetModel ? ` · ${loan.assetModel}` : ""} · ${loanStatusLabel(loan.status)}`}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(new FormData(e.currentTarget));
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="id" value={loan.id} />
        <Field label="대여자">
          <input name="borrowerName" defaultValue={loan.borrowerName} maxLength={80} required className={FIELD} />
        </Field>
        <Field label="소속">
          <input name="dept" defaultValue={loan.dept ?? ""} maxLength={80} placeholder="예: 강사 · 경영지원팀" className={FIELD} />
        </Field>
        <Field label="대여일">
          <input type="date" name="lentOn" defaultValue={loan.lentOn ?? ""} className={FIELD} />
        </Field>
        <Field label="반납예정">
          <input type="date" name="dueOn" defaultValue={loan.dueOn ?? ""} className={FIELD} />
        </Field>
        {/* 날짜가 아닌 표기(`상시`)는 반납예정을 비웠을 때만 쓰인다 — 서버가 그렇게 가른다. */}
        <Field label="반납예정 표기" hint="날짜 대신 적을 말(예: 상시). 반납예정일을 비웠을 때만 쓰입니다.">
          <input name="dueNote" defaultValue={loan.dueNote ?? ""} maxLength={40} className={FIELD} />
        </Field>
        <Field label="비고" className="sm:col-span-2">
          <textarea name="note" defaultValue={loan.note ?? ""} maxLength={500} className={TEXTAREA} />
        </Field>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <DeleteRowButton
            id={loan.id}
            action={deleteLoan}
            label={`대여 기록 삭제 — ${loan.loanCode}`}
            confirm={
              loan.status === "out"
                ? "이 대여 기록을 지웁니다. 되돌릴 수 없습니다. 대여 중인 기록이라 자산 상태도 대여 전으로 함께 되돌립니다."
                : "이 대여 기록을 지웁니다. 되돌릴 수 없습니다."
            }
            successMessage="대여 기록을 지웠습니다"
            onDone={onClose}
          />
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={busy}>
            저장
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
