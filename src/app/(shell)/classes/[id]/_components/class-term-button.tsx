"use client";

import { useActionState, useState } from "react";
import { CalendarCheck, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { endClassTerm, reopenClassTerm } from "@/features/classes/server/actions";

/**
 * 종강/재개강 — 폐지(ArchiveClassButton, is_active)와 별개의 '운영 종료일'(closed_at).
 * 종강 반은 타임머신 과거 주(종강일 이전)엔 수강이력으로 남고, 종강일 이후 주·현재에선 숨는다.
 */
export function ClassTermButton({
  classId,
  className,
  closedAt,
}: {
  classId: string;
  className: string;
  closedAt: string | null;
}) {
  const [endState, endAction, endPending] = useActionState(endClassTerm, undefined);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenClassTerm, undefined);
  const [open, setOpen] = useState(false);
  const [today] = useState(() => kstToday());

  // 이미 종강 → 재개강
  if (closedAt) {
    return (
      <form
        action={reopenAction}
        onSubmit={(e) => {
          if (!confirm(`"${className}" 반을 다시 개강할까요? 시간표·일정에 다시 표시됩니다.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={classId} />
        <Button type="submit" variant="outline" size="sm" disabled={reopenPending}>
          <RotateCcw className="size-4" />
          재개강
        </Button>
        {reopenState?.error ? <span className="text-danger ml-2 text-xs">{reopenState.error}</span> : null}
      </form>
    );
  }

  // 운영중 → 종강(날짜 지정)
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarCheck className="size-4" />
        종강
      </Button>
    );
  }

  return (
    <form action={endAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={classId} />
      <input
        type="date"
        name="date"
        defaultValue={today}
        max={today}
        aria-label="종강일"
        className="border-line rounded-md border px-2 py-1 text-xs"
      />
      <Button type="submit" size="sm" disabled={endPending}>
        종강 확정
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-text-faint hover:text-foreground text-xs"
      >
        취소
      </button>
      {endState?.error ? <span className="text-danger ml-1 text-xs">{endState.error}</span> : null}
    </form>
  );
}
