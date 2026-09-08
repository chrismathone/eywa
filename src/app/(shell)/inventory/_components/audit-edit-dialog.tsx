"use client";

import { Button } from "@/components/ui/button";
import { AUDIT_RESULTS, AUDIT_RESULT_LABEL } from "@/features/inventory/audit-result";
import { deleteAudit, updateAudit } from "@/features/inventory/server/audit-actions";
import type { InventoryAudit } from "@/features/inventory/types";
import { DeleteRowButton } from "./delete-row-button";
import { DialogShell, FIELD, Field, FormError, SELECT, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 실사 기록 수정·삭제 — 실사 면의 행 더블클릭(원장 2026-09-08
 * *"기존 실사 기록을 수정하려고 더블클릭해도 수정하거나 삭제할 수 없음"*).
 *
 * 🔴 **자산은 못 바꾼다** — 다른 자산으로 옮기는 건 정정이 아니라 새 기록이다(두 자산의 `최종실사`가
 *    한꺼번에 어긋난다). 자산을 잘못 골랐으면 지우고 다시 기록한다(그래서 삭제가 같은 창에 있다).
 * 🔑 실사일·삭제 뒤 자산의 `최종실사`는 서버가 **남은 기록에서 다시 계산**한다.
 */
export function AuditEditDialog({
  audit,
  today,
  onClose,
}: {
  audit: InventoryAudit;
  today: string;
  onClose: () => void;
}) {
  const { busy, error, submit } = useSubmit();

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, updateAudit, "실사 기록을 수정했습니다");
    if (res) onClose();
  }

  return (
    <DialogShell
      title={`실사 수정 — ${audit.auditCode}`}
      description={`${audit.assetCode}${audit.assetModel ? ` · ${audit.assetModel}` : ""} · 자산은 바꿀 수 없습니다`}
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
        <input type="hidden" name="id" value={audit.id} />
        <Field label="실사일">
          <input type="date" name="auditedOn" defaultValue={audit.auditedOn} required max={today} className={FIELD} />
        </Field>
        <Field label="결과">
          <select name="result" defaultValue={audit.result} className={SELECT}>
            {AUDIT_RESULTS.map((r) => (
              <option key={r} value={r}>
                {AUDIT_RESULT_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="확인위치">
          <input
            name="location"
            defaultValue={audit.location ?? ""}
            maxLength={120}
            placeholder="못 찾았으면 비워 두세요"
            className={FIELD}
          />
        </Field>
        <Field label="확인자">
          <input name="auditorName" defaultValue={audit.auditorName ?? ""} maxLength={80} className={FIELD} />
        </Field>
        <Field label="조치" className="sm:col-span-2">
          <input
            name="action"
            defaultValue={audit.action ?? ""}
            maxLength={200}
            placeholder="예: 사용자 연락 · 2층 전수조사 · 재점검"
            className={FIELD}
          />
        </Field>
        <Field label="비고" className="sm:col-span-2">
          <textarea name="note" defaultValue={audit.note ?? ""} maxLength={500} className={TEXTAREA} />
        </Field>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <DeleteRowButton
            id={audit.id}
            action={deleteAudit}
            label={`실사 기록 삭제 — ${audit.auditCode}`}
            confirm="이 실사 기록을 지웁니다. 되돌릴 수 없습니다. 그 자산의 '최종실사'는 남은 기록으로 다시 계산됩니다."
            successMessage="실사 기록을 지웠습니다"
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
