"use client";

import { useState } from "react";
import { Plus } from "@/components/icons/aywa-icon-compat";
import {
  EnrollmentAssignDialog,
  type AssignDialogClass,
  type AssignDialogStudent,
} from "@/components/enrollment-assign-dialog";

export function StudentAssignAction({
  student,
  classes,
  blockedReason,
  allowTransfer = true,
}: {
  student: AssignDialogStudent;
  classes: AssignDialogClass[];
  /**
   * 배정 창의 '반이동' 토글 — 서버 `moveEnrollmentsBatch`와 같은 판정(`canManageTenant(role, "classes")`)을
   * 부모(서버)가 계산해 내린다. 기본값 true = 아직 안 내리는 호출처의 종전 동작(lib/write-lock.ts 규칙 1).
   */
  allowTransfer?: boolean;
  /**
   * 이 학생 상태로는 배정할 수 없을 때의 **한글 이유**(휴원·퇴원·상담 단계).
   * 🔴 버튼만 감추면 "왜 못 하는지"를 알 수 없다 — 이유와 할 일을 그 자리에 그대로 적는다.
   *    ⚠️ 화면 조건은 게이트가 아니다: 진짜 거절은 서버 `createEnrollment`가 한다(#77, 둘 다 필요).
   */
  blockedReason?: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (blockedReason) {
    return <p className="text-amber max-w-xs text-right text-xs">{blockedReason}</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-chart-1 hover:underline inline-flex items-center gap-1 text-xs"
      >
        <Plus className="size-3" />
        반 배정
      </button>
      <EnrollmentAssignDialog
        open={open}
        onClose={() => setOpen(false)}
        mode="add-class-to-student"
        student={student}
        classes={classes}
        allowTransfer={allowTransfer}
      />
    </>
  );
}
