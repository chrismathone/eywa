"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { Button } from "@/components/ui/button";
import {
  updateWithdrawalReason,
  type WithdrawalReasonState,
} from "@/features/withdrawals/server/actions";
import { WITHDRAWAL_REASONS, type WithdrawalReason } from "@/features/withdrawals/types";
import { ReasonFields } from "@/features/withdrawals/reason-fields";
import { submitAction } from "@/components/forms/submit-action";

const FIELD_LABEL = "text-foreground block text-sm font-medium";
const FIELD_CONTROL =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

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
  initialDetail,
  initialMemo,
}: {
  studentId: string;
  initialReason: WithdrawalReason | null;
  initialDetail: string | null;
  initialMemo: string | null;
}) {
  // 초안을 되살리면 사유 입력을 그 값으로 다시 세운다(세부 칸은 고른 대분류를 따라 바뀌어서 DOM 복원만으로는 안 맞는다).
  const [restored, setRestored] = useState<{ n: number; reason: WithdrawalReason | null; detail: string | null; memo: string | null } | null>(null);
  const [state, formAction] = useActionState<WithdrawalReasonState, FormData>(
    updateWithdrawalReason,
    undefined,
  );

  // 로컬 초안 자동저장 — 메모(자유 기록)를 저장 전 새로고침/창닫기에서 지킨다. 저장 성공 시 초안 삭제.
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft({
    scope: `withdrawal-reason:${studentId}`,
    formRef,
    exclude: ["studentId"],
    // 사유·세부 select는 처음부터 값이 있을 수 있다 — 빈 폼 오탐 방지로 배너 판정서 제외.
    ignoreForBanner: ["reason", "detail"],
    onRestore: (v) =>
      setRestored((prev) => ({
        n: (prev?.n ?? 0) + 1,
        reason: (WITHDRAWAL_REASONS as readonly string[]).includes(v.reason ?? "") ? (v.reason as WithdrawalReason) : initialReason,
        detail: v.detail || null,
        memo: v.memo ?? null,
      })),
  });
  const clearDraft = draft.clear;
  // 성공 판정은 state?.ok — 액션이 성공 시 {ok:true}를 반환한다(undefined면 성공 감지 불가, 리뷰 지적).
  useEffect(() => {
    if (state?.ok) clearDraft();
  }, [state, clearDraft]);

  return (
    <form ref={formRef} onSubmit={(e) => submitAction(e, formAction)} className="space-y-4">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      <input type="hidden" name="studentId" value={studentId} />

      {/* 대분류 · 세부(선택) · 메모(기타는 필수) — 상태 전환 창과 같은 부품(원장 2026-10-15 사유 2단계). */}
      <ReasonFields
        key={restored?.n ?? 0}
        reasonLabel="퇴원 사유 *"
        initialReason={restored ? restored.reason : initialReason}
        initialDetail={restored ? restored.detail : initialDetail}
        initialMemo={restored ? restored.memo : initialMemo}
        memoPlaceholder="구체적인 사유 / 학부모 의견 등 자유 기록"
        labelClassName={FIELD_LABEL}
        controlClassName={FIELD_CONTROL}
      />

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
