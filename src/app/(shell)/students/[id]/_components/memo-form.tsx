"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createStudentMemo, type CreateMemoState } from "@/features/students/server/actions";

const CATEGORIES = [
  { value: "general", label: "일반" },
  { value: "homework", label: "숙제/과제" },
  { value: "behavior", label: "행동" },
  { value: "parent", label: "학부모" },
  { value: "health", label: "건강" },
  { value: "other", label: "기타" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      메모 추가
    </Button>
  );
}

export function MemoForm({ studentId }: { studentId: string }) {
  const [state, formAction] = useActionState<CreateMemoState, FormData>(
    createStudentMemo,
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
      className="bg-bg-soft/30 border-border space-y-2 rounded-md border p-3"
    >
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex items-center gap-2">
        <select
          name="category"
          defaultValue="general"
          className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-[11px]">분류</span>
      </div>
      <textarea
        name="content"
        required
        rows={3}
        placeholder="메모를 입력하세요..."
        className="border-border bg-card text-foreground w-full rounded-md border px-2 py-2 text-sm"
      />
      {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
