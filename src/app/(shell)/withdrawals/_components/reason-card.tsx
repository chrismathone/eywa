"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  updateWithdrawalReason,
  type WithdrawalReasonState,
} from "@/features/withdrawals/server/actions";
import { REASON_LABEL, type WithdrawalReason } from "@/features/withdrawals/types";
import { submitAction } from "@/components/forms/submit-action";

const REASON_OPTIONS: { value: WithdrawalReason; label: string }[] = (
  Object.keys(REASON_LABEL) as WithdrawalReason[]
).map((k) => ({ value: k, label: REASON_LABEL[k] }));

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      사유 저장
    </Button>
  );
}

export function WithdrawalReasonCard({
  studentId,
  initialReason,
  initialMemo,
}: {
  studentId: string;
  initialReason: WithdrawalReason | null;
  initialMemo: string | null;
}) {
  const [state, formAction] = useActionState<WithdrawalReasonState, FormData>(
    updateWithdrawalReason,
    undefined,
  );

  return (
    <form onSubmit={(e) => submitAction(e, formAction)} className="space-y-4">
      <input type="hidden" name="studentId" value={studentId} />

      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-foreground block text-sm font-medium">
          퇴원 사유 *
        </label>
        <select
          id="reason"
          name="reason"
          defaultValue={initialReason ?? "other"}
          required
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="memo" className="text-foreground block text-sm font-medium">
          메모
        </label>
        <textarea
          id="memo"
          name="memo"
          defaultValue={initialMemo ?? ""}
          rows={3}
          placeholder="구체적인 사유 / 학부모 의견 등 자유 기록"
          className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
