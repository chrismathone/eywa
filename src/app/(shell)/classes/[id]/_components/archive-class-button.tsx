"use client";

import { useActionState } from "react";
import { Archive, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { archiveClass, type ArchiveClassState } from "@/features/classes/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

/**
 * 반 폐지/재운영 토글 — is_active 반전 + 그 반 활성 수강 종료/복원(archiveClass).
 * ⚠️ 폐지는 경고를 띄우고 종강(ClassTermButton)은 안 띄운다 — 원장 지시(2026-07-15).
 * 종강은 정상적인 운영 종료라 일상 동작이고, 폐지는 '없던 일로' 돌리는 비일상 동작이라 확인을 받는다.
 */
export function ArchiveClassButton({
  classId,
  isActive,
  className,
  enrolledCount,
}: {
  classId: string;
  isActive: boolean;
  className: string;
  /** 이 반의 활성 수강 학생 수 — 폐지 경고에 실제 영향 범위를 보여준다. */
  enrolledCount: number;
}) {
  // 성공은 `undefined`로 온다(초기값과 같아 effect로 못 잡는다) — 결과를 받는 자리에서 바로 알린다.
  const [state, formAction] = useActionState(
    async (prev: ArchiveClassState, formData: FormData) => {
      const res = await archiveClass(prev, formData);
      if (!res?.error) notifyTermPlansChanged();
      return res;
    },
    undefined,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const impact =
          enrolledCount > 0
            ? `\n\n재원생 ${enrolledCount}명의 수강이 오늘 날짜로 종료됩니다. 다른 과목 수강이 없는 학생은 '수업 없는 재원생'으로 남아 대시보드에서 반을 다시 배정할 수 있습니다.`
            : "";
        const msg = isActive
          ? `"${className}" 반을 폐지할까요? 시간표·목록에서 종료 처리됩니다 (기록은 보존).${impact}\n\n재운영하면 되돌아갑니다.`
          : `"${className}" 반을 다시 운영할까요? 폐지 때 종료된 수강도 함께 복원됩니다.`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={classId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant="outline">
        {isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
        {isActive ? "반 폐지" : "재운영"}
      </Button>
      {state?.error ? <span className="text-danger ml-2 text-xs">{state.error}</span> : null}
    </form>
  );
}
