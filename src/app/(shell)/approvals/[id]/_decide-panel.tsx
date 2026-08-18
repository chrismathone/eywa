"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  confirmDeferredStep,
  decideDocument,
  withdrawDocument,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";

/**
 * 도장칸의 '결재' 칩 — **처리자 전용 버튼**. 앵커(#decide)는 창(iframe)·스크롤 컨테이너 조합에서
 * 이동이 안 보일 때가 있어(원장 제보 "클릭만 되고 아무 기능 안 함") 스크립트로 확실히:
 * 결재 패널로 스크롤 + 의견 입력에 포커스(여기서 처리하라는 신호).
 */
export function TurnChip() {
  return (
    <button
      type="button"
      onClick={() => {
        const el = document.getElementById("decide");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.querySelector<HTMLInputElement>('input[name="comment"]')?.focus({ preventScroll: true });
      }}
      className="border-primary text-primary hover:bg-primary-soft/50 inline-flex items-center rounded-md border px-2.5 py-1 text-[12px] font-bold transition"
      title="아래 결재 패널로 이동합니다"
    >
      결재
    </button>
  );
}

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

function DecideButtons({ canFinal, disabled }: { canFinal: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <span className="flex items-center gap-2">
      {pending ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
      <Button
        type="submit"
        name="decision"
        value="rejected"
        variant="outline"
        disabled={pending || disabled}
      >
        반려
      </Button>
      {canFinal ? (
        <Button
          type="submit"
          name="decision"
          value="final"
          variant="outline"
          disabled={pending || disabled}
          title="이 단계에서 문서를 즉시 승인 종결합니다(남은 결재 단계 생략)"
        >
          전결
        </Button>
      ) : null}
      <Button type="submit" name="decision" value="approved" disabled={pending || disabled}>
        승인
      </Button>
    </span>
  );
}

/**
 * 결재 처리 — 의견을 함께 싣는다(승인·반려·전결은 같은 폼의 서로 다른 submit 버튼).
 *
 * mode="proxy" = **대결**(원장이 부재중인 현재 차례 결재자를 대신해 처리 — 0216a acted_by).
 * `deferTargets` = 내 앞의 미결 결재자들 — 부재중이면 **후결로 넘기고** 내가 먼저 결재할 수 있다.
 * 체크해야 버튼이 열린다(아직 내 차례가 아니라는 사실을 사용자가 인지하고 넘겨야 한다).
 */
export function DecidePanel({
  documentId,
  mode = "turn",
  canFinal = false,
  deferTargets = [],
}: {
  documentId: string;
  mode?: "turn" | "proxy";
  /** 전결 버튼 노출 — 마지막 살아있는 단계면 전결=승인이라 숨긴다(호출부가 계산). */
  canFinal?: boolean;
  /** 내 앞의 미결 결재자 이름들 — 비어 있지 않으면 후결 체크박스가 뜬다. */
  deferTargets?: string[];
}) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(decideDocument, undefined);
  const [deferChecked, setDeferChecked] = useState(false);
  useResultToast(state);

  const needsDefer = deferTargets.length > 0;

  return (
    <form
      action={action}
      id="decide" // 결재란 사인 칸의 `결재` 칩(#decide 앵커)이 여기로 스크롤한다
      className="border-primary/30 bg-primary-soft/30 space-y-2.5 scroll-mt-4 rounded-2xl border p-4"
    >
      <input type="hidden" name="documentId" value={documentId} />
      {deferChecked ? <input type="hidden" name="deferPrevious" value="1" /> : null}

      {mode === "proxy" ? (
        <p className="text-text-dim text-[11px]">
          현재 차례 결재자를 대신해 <b className="text-foreground">대결</b> 처리합니다 — 결재란에는
          대결 처리자가 함께 기록됩니다.
        </p>
      ) : null}

      {needsDefer ? (
        <label className="flex items-start gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={deferChecked}
            onChange={(e) => setDeferChecked(e.target.checked)}
            className="accent-primary mt-0.5 size-3.5"
          />
          <span className="text-text-dim break-keep">
            앞 단계(<b className="text-foreground">{deferTargets.join(" · ")}</b>)가 부재중 —{" "}
            <b className="text-foreground">후결로 넘기고</b> 먼저 결재합니다. 넘어간 결재자는 나중에
            후결 확인을 합니다.
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          name="comment"
          maxLength={500}
          placeholder="의견 (선택) — 반려 사유를 적으면 기안자에게 남습니다"
          className={`${inputClass} sm:max-w-[420px]`}
        />
        <DecideButtons canFinal={canFinal} disabled={needsDefer && !deferChecked} />
      </div>
    </form>
  );
}

function ConfirmDeferredButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      후결 확인
    </Button>
  );
}

/**
 * 후결 확인 — 부재로 건너뛰어진 결재자가 돌아와 사후 확인한다(하이웍스 후열 '확인').
 * 문서 진행·종결과 무관한 확인이라 반려는 없다(문서는 이미 진행됐다 — 0216a 주석).
 */
export function DeferredConfirmPanel({ documentId }: { documentId: string }) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(
    confirmDeferredStep,
    undefined,
  );
  useResultToast(state);

  return (
    <form
      action={action}
      className="border-amber/40 bg-amber-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
    >
      <input type="hidden" name="documentId" value={documentId} />
      <p className="text-text-dim text-[12px] break-keep">
        부재중에 <b className="text-foreground">후결</b>로 넘어간 문서입니다 — 내용 확인 후 후결
        확인을 눌러 주세요.
      </p>
      <ConfirmDeferredButton />
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
