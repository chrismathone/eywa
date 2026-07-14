"use client";

import { useActionState } from "react";
import { Archive, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { archiveClass } from "@/features/classes/server/actions";

/** 반 폐지/재운영 토글 — is_active 반전. 폐지하면 시간표·목록에서 '종료' 처리(데이터는 보존). */
export function ArchiveClassButton({
  classId,
  isActive,
  className,
}: {
  classId: string;
  isActive: boolean;
  className: string;
}) {
  const [state, formAction] = useActionState(archiveClass, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const msg = isActive
          ? `"${className}" 반을 폐지할까요? 시간표·목록에서 종료 처리됩니다 (기록은 보존).`
          : `"${className}" 반을 다시 운영할까요?`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={classId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant="outline" size="sm">
        {isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
        {isActive ? "반 폐지" : "재운영"}
      </Button>
      {state?.error ? <span className="text-danger ml-2 text-xs">{state.error}</span> : null}
    </form>
  );
}
