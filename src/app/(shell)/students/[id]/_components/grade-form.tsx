"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Plus } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { createStudentGrade, type CreateGradeState } from "@/features/students/server/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      성적 추가
    </Button>
  );
}

export function GradeForm({
  studentId,
  subjectOptions,
}: {
  studentId: string;
  subjectOptions: { value: string; label: string }[];
}) {
  const [state, formAction] = useActionState<CreateGradeState, FormData>(
    createStudentGrade,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const success = state && !state.error;

  useEffect(() => {
    if (success) formRef.current?.reset();
  }, [success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-bg-soft/30 border-border rounded-md border p-3"
    >
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <input
          name="takenOn"
          type="date"
          required
          defaultValue={kstToday()}
          className="border-border bg-card text-foreground num rounded-md border px-2 py-1 text-xs sm:col-span-1"
        />
        <select
          name="subject"
          required
          className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs sm:col-span-1"
        >
          {subjectOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          name="examName"
          type="text"
          required
          placeholder="시험명"
          className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs sm:col-span-1"
        />
        <input
          name="score"
          type="number"
          step="0.01"
          placeholder="점수"
          className="border-border bg-card text-foreground num rounded-md border px-2 py-1 text-xs sm:col-span-1"
        />
        <input
          name="maxScore"
          type="number"
          step="0.01"
          placeholder="만점"
          className="border-border bg-card text-foreground num rounded-md border px-2 py-1 text-xs sm:col-span-1"
        />
        <Submit />
      </div>
      <input
        name="notes"
        type="text"
        placeholder="메모 (선택)"
        className="border-border bg-card text-foreground mt-2 w-full rounded-md border px-2 py-1 text-xs"
      />
      {state?.error ? <p className="text-chart-4 mt-2 text-xs">{state.error}</p> : null}
    </form>
  );
}
