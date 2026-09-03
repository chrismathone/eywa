"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { createStudentMemo, type CreateMemoState } from "@/features/students/server/actions";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";

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

  // 로컬 초안 자동저장 — 작성 중 메모를 새로고침/창닫기에서 지킨다. 저장 성공 시 초안 삭제(reset과 함께).
  const draft = useFormDraft({
    scope: `student-memo:${studentId}`,
    formRef,
    exclude: ["studentId"],
    ignoreForBanner: ["category"],
  });
  const clearDraft = draft.clear;

  // ⚠️ 성공 판정은 state?.ok(액션이 성공 시 {ok:true} 반환) + 의존성은 state 객체 —
  //    boolean 파생값에 걸면 연속 저장부터 effect가 안 돌아 reset·초안 삭제가 죽는다(리뷰 지적).
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      clearDraft();
    }
  }, [state, clearDraft]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-bg-soft/30 border-border space-y-2 rounded-2xl border p-3"
    >
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex items-center gap-2">
        <select
          name="category"
          defaultValue="general"
          className="border-border bg-card text-foreground rounded-lg border px-2 py-1 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">분류</span>
      </div>
      <textarea
        name="content"
        required
        rows={3}
        placeholder="메모를 입력하세요..."
        className="border-border bg-card text-foreground w-full rounded-lg border px-2 py-2 text-sm"
      />
      {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
