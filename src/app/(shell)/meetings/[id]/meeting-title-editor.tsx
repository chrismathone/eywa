"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Pencil, X } from "@/components/icons/aywa-icon-compat";
import {
  updateMeetingTitle,
  type UpdateMeetingTitleState,
} from "@/features/meetings/server/actions";
import { useEditPresence } from "@/features/presence/edit-presence";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-primary hover:bg-bg-soft rounded-sm p-1 transition disabled:opacity-50"
      aria-label="제목 저장"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
    </button>
  );
}

/**
 * 회의록 제목 인라인 편집 — 연필 토글 → input → 저장(updateMeetingTitle). 성공 시 닫힘+revalidate.
 * `canWrite`(페이지가 updateMeetingTitle과 같은 canWriteTenant("meetings")로 계산)가 거짓이면 연필 없이 제목만.
 */
export function MeetingTitleEditor({ meetingId, title, canWrite }: { meetingId: string; title: string; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<UpdateMeetingTitleState, FormData>(
    updateMeetingTitle,
    undefined,
  );
  const handled = useRef(false);

  // "수정중" presence — 제목 편집이 열려 있는 동안 track(닫히면 자동 해제).
  useEditPresence(`meeting:${meetingId}`, editing);

  useEffect(() => {
    if (state?.ok && !handled.current) {
      handled.current = true;
      setEditing(false);
    }
  }, [state]);

  if (!editing || !canWrite) {
    return (
      <h1 className="font-bold tracking-tight text-foreground group flex items-center gap-2 text-3xl">
        {title}
        {canWrite ? <button
          type="button"
          onClick={() => {
            handled.current = false;
            setEditing(true);
          }}
          className="text-text-faint hover:text-foreground opacity-0 transition group-hover:opacity-100"
          aria-label="제목 수정"
        >
          <Pencil className="size-4" />
        </button> : null}
      </h1>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={meetingId} />
      <input
        name="title"
        defaultValue={title}
        autoFocus
        className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-2xl font-bold"
      />
      <SaveBtn />
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-text-faint hover:text-foreground rounded-sm p-1 transition"
        aria-label="취소"
      >
        <X className="size-4" />
      </button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}
