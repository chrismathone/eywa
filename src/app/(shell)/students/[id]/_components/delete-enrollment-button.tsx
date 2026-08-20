"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2 } from "@/components/icons/eywa-icon-compat";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { deleteEnrollment } from "@/features/enrollments/server/actions";

/**
 * 잘못 만든 **수업 이력 삭제**(원장·super_admin) — 학생 상세 '수업' 탭의 수강 행.
 *
 * 원장 2026-08-20: *"이런 잘못된 수업 이력을 지우고 싶은데 마스터 및 원장에게 권한부여"*.
 * ⚠️ 이 버튼은 '수강 종료'(end_date를 넣어 닫는 것)와 **다른 물건**이다 — 행 자체가 사라진다.
 *    그래서 확인 창에 반 이름·기간을 그대로 보여주고 되돌릴 수 없음을 말한다.
 * 🔴 화면 조건은 게이트가 아니다 — 붙은 기록 검사·권한 판정은 서버 `deleteEnrollment`가 다시 한다(#77).
 */
export function DeleteEnrollmentButton({
  enrollmentId,
  className,
  periodLabel,
}: {
  enrollmentId: string;
  /** 반 이름 — 확인 창에 그대로 보여준다. */
  className: string;
  /** "2026-08-19 ~ 2026-08-19" 또는 "2026-08-19부터". */
  periodLabel: string;
}) {
  const [state, formAction] = useActionState(deleteEnrollment, undefined);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // 거절 사유(붙은 기록 N건 등)는 길다 — 표 칸 안 작은 글씨로만 두면 놓친다. 가운데 토스트 병행.
  const notified = useRef<typeof state>(undefined);
  useEffect(() => {
    if (state === notified.current) return;
    notified.current = state;
    if (state?.error) conflictToast(state.error);
  }, [state]);

  return (
    <>
      <form ref={formRef} action={formAction} className="inline">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title="이 수업 이력을 완전히 삭제합니다 (수강 종료와 다름 · 되돌릴 수 없음)"
          className="text-text-dim hover:text-danger hover:border-danger/30 hover:bg-danger/10 inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
        >
          <Trash2 className="size-3" />
          삭제
        </button>
      </form>
      <ConfirmDialog
        open={confirming}
        danger
        title="수업 이력을 삭제할까요?"
        message={`${className} · ${periodLabel} — 이 수강 기록이 완전히 사라집니다. 되돌릴 수 없습니다(감사로그에는 남습니다). 출결·수업보고서·청구가 붙어 있으면 삭제되지 않고 이유를 알려드립니다.`}
        confirmLabel="삭제"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
      />
      {state?.error ? (
        <span className="text-danger ml-1 inline-block max-w-[10rem] truncate align-middle text-[10px]" title={state.error}>
          {state.error}
        </span>
      ) : null}
    </>
  );
}
