"use client";

import { useActionState, useState } from "react";
import { CalendarCheck, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { endClassTerm, reopenClassTerm, type ClassTermState } from "@/features/classes/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

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
  // 성공은 `undefined`로 온다(초기값과 같아 effect로 못 잡는다) — 결과를 받는 자리에서 바로 알린다.
  const [endState, endAction, endPending] = useActionState(
    async (prev: ClassTermState, formData: FormData) => {
      const res = await endClassTerm(prev, formData);
      if (!res?.error) notifyTermPlansChanged();
      return res;
    },
    undefined,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    async (prev: ClassTermState, formData: FormData) => {
      const res = await reopenClassTerm(prev, formData);
      if (!res?.error) notifyTermPlansChanged();
      return res;
    },
    undefined,
  );
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
        <Button type="submit" variant="outline" disabled={reopenPending}>
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
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
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
        className="border-line h-8 rounded-lg border px-2 text-xs"
      />
      <Button type="submit" disabled={endPending}>
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
