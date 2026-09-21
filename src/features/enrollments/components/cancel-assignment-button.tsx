"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { XCircle } from "@/components/icons/aywa-icon-compat";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { deleteEnrollment } from "../server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

/**
 * **배정 취소** — 아직 시작도 안 한 배정(예정)을 없던 일로 되돌린다.
 *
 * 원장 2026-09-01: *"대기학생은 '수강 종료' 대신 '배정 취소' 버튼 추가해줘. 배정 취소 하면 아무일도
 * 없던것처럼 되는거지."*
 *
 * 🔑 '수강 종료'와 **다른 물건**이다 — 종료는 `end_date`를 넣어 기록을 남기고 닫지만, 취소는 행 자체를
 *    지운다(아직 아무 일도 없었으므로 남길 기록이 없다). 서버는 기존 [`deleteEnrollment`] 그대로다
 *    (붙은 기록 검사·감사로그 스냅샷·테넌트 확인이 이미 그 안에 있다 — 새로 짜면 한쪽만 고쳐진다, #77).
 * 🔴 화면 조건은 게이트가 아니다 — 서버가 **아직 시작 안 한 배정인지**를 다시 확인하고, 시작한 수강이면
 *    거절하며 '수강 종료'를 안내한다.
 */
export function CancelAssignmentButton({
  enrollmentId,
  className,
  startDate,
  studentName,
}: {
  enrollmentId: string;
  /** 반 이름 — 확인 창에 그대로 보여준다. */
  className: string;
  /** 배정 시작 예정일(YYYY-MM-DD). */
  startDate: string;
  /** 반 상세처럼 여러 학생이 한 화면에 있는 곳에서 누구를 취소하는지. */
  studentName?: string;
}) {
  const [state, formAction] = useActionState(deleteEnrollment, undefined);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // 거절 사유는 길다 — 표 칸 안 작은 글씨로만 두면 놓친다(삭제 버튼과 같은 규약).
  const notified = useRef<typeof state>(undefined);
  useEffect(() => {
    if (state === notified.current) return;
    notified.current = state;
    if (state?.error) conflictToast(state.error);
    else if (state?.ok) notifyTermPlansChanged();
  }, [state]);

  return (
    <>
      <form ref={formRef} action={formAction} className="inline">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title="아직 시작 전인 배정을 없던 일로 되돌립니다 (수강 종료와 다름)"
          className="text-text-dim hover:text-danger hover:border-danger/30 hover:bg-danger/10 inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
        >
          <XCircle className="size-3" />
          배정 취소
        </button>
      </form>
      <ConfirmDialog
        open={confirming}
        danger
        title="배정을 취소할까요?"
        message={`${studentName ? `${studentName} · ` : ""}${className} · ${startDate}부터 예정 — 아직 시작 전이라 이 배정을 없던 일로 되돌립니다(감사로그에는 남습니다).`}
        confirmLabel="배정 취소"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
      />
      {state?.error ? (
        <span
          className="text-danger ml-1 inline-block max-w-[10rem] truncate align-middle text-xs"
          title={state.error}
        >
          {state.error}
        </span>
      ) : null}
    </>
  );
}
