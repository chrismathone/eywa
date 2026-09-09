"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useResultToast } from "@/components/action-toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  confirmDeferredStep,
  decideDocument,
  withdrawDocument,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";

/**
 * 결재란 '결재' 칩 → 결재 창 — 칩은 결재란 표 안, 창 상태는 아래 DecidePanel이 들고 있어
 * window 이벤트로 잇는다(둘은 같은 페이지에서만 함께 마운트된다 — page.tsx의 actionable 판정).
 */
const OPEN_DECIDE_EVENT = "eywa:approval-open-decide";

/**
 * 도장칸의 '결재' 칩 — **처리자 전용 버튼**. 하이웍스처럼 누르면 결재 창(다이얼로그)이 바로 뜬다
 * (원장 2026-08-19: "결재 버튼 클릭하고 창으로 버튼·의견 받아서 넘기자").
 */
export function TurnChip() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_DECIDE_EVENT))}
      className="border-primary text-primary hover:bg-primary-soft/50 inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold transition"
      title="결재 창을 엽니다"
    >
      결재
    </button>
  );
}

// 액션 결과 토스트 훅은 연차 조정 화면(직원관리)도 쓴다 — 사본을 늘리지 않으려 공용
// [`@/components/action-toast`]로 옮기고 여기서 다시 내보낸다(기존 import 경로 `./_decide-panel`은 그대로 산다).
export { useResultToast };

type Decision = "approved" | "rejected" | "final";

/** 결재 창·댓글 입력 공용 textarea 클래스 — 폼 스타일 조정은 여기 한 곳(_comments.tsx도 쓴다). */
export const APPROVAL_TEXTAREA_CLASS =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary resize-none rounded-lg border px-3 py-2 text-sm outline-none transition";

/** 결재 창 선택지 라벨·설명 — 하이웍스 결재 팝업의 라디오 대응. 한 곳에서만 정한다. */
const DECISION_META: Record<Decision, { label: string; desc: string }> = {
  approved: {
    label: "승인",
    desc: "다음 결재자에게 넘어갑니다. 마지막 단계면 최종 승인으로 종결됩니다.",
  },
  final: {
    label: "전결",
    desc: "남은 결재 단계를 생략하고 이 단계에서 즉시 승인 종결합니다 — 뒤 결재자는 결재하지 않습니다.",
  },
  rejected: {
    label: "반려",
    desc: "문서를 반려로 종결합니다 — 사유를 의견에 남겨 주세요.",
  },
};

function ConfirmButton({ decision, disabled }: { decision: Decision; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={decision === "rejected" ? "destructive" : "default"}
      disabled={pending || disabled}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {DECISION_META[decision].label}
    </Button>
  );
}

/**
 * 결재 처리 — 하이웍스처럼 '결재' 버튼을 누르면 **창**이 뜨고, 창에서 구분(승인·전결·반려)을
 * 고르고 의견을 적어 확정한다(원장 2026-08-19 스크린샷 대응).
 *
 * mode="proxy" = **대결**(원장이 부재중인 현재 차례 결재자를 대신해 처리 — 0216a acted_by).
 * `deferTargets` = 내 앞의 미결 결재자들 — 부재중이면 **후결로 넘기고** 내가 먼저 결재할 수 있다.
 * 체크해야 확정 버튼이 열린다(아직 내 차례가 아니라는 사실을 사용자가 인지하고 넘겨야 한다).
 *
 * 구분·의견은 전부 컨트롤드 — React 19가 `<form action>` 제출마다 폼을 자동 리셋해도([[#83]])
 * 에러로 창이 남았을 때 선택·의견이 지워지지 않는다(전송 값 = 라디오 `decision` 그 자체).
 */
export function DecidePanel({
  documentId,
  mode = "turn",
  canFinal = false,
  deferTargets = [],
}: {
  documentId: string;
  mode?: "turn" | "proxy";
  /** 전결 선택지 노출 — 마지막 살아있는 단계면 전결=승인이라 숨긴다(호출부가 계산). */
  canFinal?: boolean;
  /** 내 앞의 미결 결재자 이름들 — 비어 있지 않으면 후결 체크박스가 뜬다. */
  deferTargets?: string[];
}) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(decideDocument, undefined);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>("approved");
  const [comment, setComment] = useState("");
  const [deferChecked, setDeferChecked] = useState(false);
  // 성공 시 창을 닫고 **입력을 전부 초기화** — 대결(proxy) 모드는 다음 단계에서도 패널이 그대로
  // 살아 있어서, 안 비우면 직전 단계의 의견·구분이 다음 결재에 그대로 실린다(적대 리뷰).
  useResultToast(state, () => {
    setOpen(false);
    setDecision("approved");
    setComment("");
    setDeferChecked(false);
  });

  const needsDefer = deferTargets.length > 0;
  const options: Decision[] = canFinal
    ? ["approved", "final", "rejected"]
    : ["approved", "rejected"];
  // 전결을 골라 두고 취소한 사이에 단계가 진행돼 canFinal이 꺼질 수 있다 — 화면에 없는 선택지가
  // 제출되지 않게 목록 밖 선택은 승인으로 접는다(적대 리뷰).
  const selected: Decision = options.includes(decision) ? decision : "approved";

  // 결재란 표 안의 '결재' 칩이 이 창을 연다(TurnChip 주석 — window 이벤트 배선).
  useEffect(() => {
    const openDialog = () => setOpen(true);
    window.addEventListener(OPEN_DECIDE_EVENT, openDialog);
    return () => window.removeEventListener(OPEN_DECIDE_EVENT, openDialog);
  }, []);

  return (
    <>
      <div className="border-primary/30 bg-primary-soft/30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
        <p className="text-text-dim text-xs break-keep">
          {mode === "proxy" ? (
            <>
              현재 차례 결재자가 부재중이면 원장이 <b className="text-foreground">대결</b>로 대신
              처리할 수 있습니다.
            </>
          ) : needsDefer ? (
            <>
              앞 단계(<b className="text-foreground">{deferTargets.join(" · ")}</b>)가 미결입니다 —
              부재중이면 후결로 넘기고 먼저 결재할 수 있습니다.
            </>
          ) : (
            <>내 결재 차례입니다 — 결재 버튼을 눌러 의견과 함께 처리하세요.</>
          )}
        </p>
        <Button onClick={() => setOpen(true)}>결재</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>결재</DialogTitle>
          </DialogHeader>
          <form action={action} className="space-y-3">
            <input type="hidden" name="documentId" value={documentId} />
            {deferChecked ? <input type="hidden" name="deferPrevious" value="1" /> : null}

            {mode === "proxy" ? (
              <p className="border-amber/40 bg-amber-soft/40 text-text-dim rounded-lg border px-3 py-2 text-xs break-keep">
                <b className="text-foreground">대결</b> — 현재 차례 결재자를 대신해 처리합니다.
                결재란에는 대결 처리자가 함께 기록됩니다.
              </p>
            ) : null}

            <div role="radiogroup" aria-label="결재 구분" className="space-y-1.5">
              {options.map((d) => (
                <label
                  key={d}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                    selected === d ? "border-primary bg-primary-soft/30" : "border-line hover:bg-bg-soft"
                  }`}
                >
                  {/* 실제 라디오가 곧 전송 값 — 화면에 그려진 선택지만 제출될 수 있다. 컨트롤드라
                      제출 자동 리셋([[#83]])에도 에러로 창이 남으면 선택이 되살아난다. */}
                  <input
                    type="radio"
                    name="decision"
                    value={d}
                    checked={selected === d}
                    onChange={() => setDecision(d)}
                    className="accent-primary mt-0.5 size-3.5"
                  />
                  <span className="min-w-0">
                    <span className="text-foreground block text-sm font-semibold">
                      {DECISION_META[d].label}
                    </span>
                    <span className="text-text-dim block text-xs break-keep">
                      {DECISION_META[d].desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {needsDefer ? (
              <label className="border-amber/40 bg-amber-soft/30 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={deferChecked}
                  onChange={(e) => setDeferChecked(e.target.checked)}
                  className="accent-primary mt-0.5 size-3.5"
                />
                <span className="text-text-dim break-keep">
                  앞 단계(<b className="text-foreground">{deferTargets.join(" · ")}</b>)가 부재중 —{" "}
                  <b className="text-foreground">후결로 넘기고</b> 먼저 결재합니다. 넘어간 결재자는
                  나중에 후결 확인을 합니다.
                </span>
              </label>
            ) : null}

            <textarea
              name="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="의견 (선택) — 반려 사유를 적으면 기안자에게 남습니다"
              className={`${APPROVAL_TEXTAREA_CLASS} w-full`}
            />

            <div className="flex items-center justify-end gap-2">
              <DialogClose render={<Button type="button" variant="outline" />}>취소</DialogClose>
              <ConfirmButton decision={selected} disabled={needsDefer && !deferChecked} />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
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
      <p className="text-text-dim text-xs break-keep">
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
      <p className="text-text-faint text-xs">아직 결재가 시작되지 않아 회수할 수 있습니다.</p>
      <WithdrawButton />
    </form>
  );
}
