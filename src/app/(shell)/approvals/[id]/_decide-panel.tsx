"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  decideDocument,
  withdrawDocument,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none transition";

/** 액션 결과를 토스트로 흘린다(성공 시 서버가 revalidate하므로 화면은 알아서 갱신된다). */
function useResultToast(state: ApprovalActionState) {
  const seen = useRef<ApprovalActionState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "처리했습니다");
  }, [state]);
}

function DecideButtons() {
  const { pending } = useFormStatus();
  return (
    <span className="flex items-center gap-2">
      {pending ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
      <Button type="submit" name="decision" value="rejected" variant="outline" disabled={pending}>
        반려
      </Button>
      <Button type="submit" name="decision" value="approved" disabled={pending}>
        승인
      </Button>
    </span>
  );
}

/** 내 결재 차례 — 의견을 함께 싣는다(승인·반려는 같은 폼의 서로 다른 submit 버튼). */
export function DecidePanel({ documentId }: { documentId: string }) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(decideDocument, undefined);
  useResultToast(state);

  return (
    <form
      action={action}
      className="border-primary/30 bg-primary-soft/30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input
        name="comment"
        maxLength={500}
        placeholder="의견 (선택) — 반려 사유를 적으면 기안자에게 남습니다"
        className={`${inputClass} sm:max-w-[440px]`}
      />
      <DecideButtons />
    </form>
  );
}

function WithdrawButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      기안 회수
    </Button>
  );
}

/** 기안자 회수 — 아직 아무도 결재하지 않았을 때만 서버가 받아준다. */
export function WithdrawPanel({ documentId }: { documentId: string }) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(withdrawDocument, undefined);
  useResultToast(state);

  return (
    <form action={action} className="flex items-center justify-end gap-3">
      <input type="hidden" name="documentId" value={documentId} />
      <p className="text-text-faint text-[11px]">아직 결재가 시작되지 않아 회수할 수 있습니다.</p>
      <WithdrawButton />
    </form>
  );
}
