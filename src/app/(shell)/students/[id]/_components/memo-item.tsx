"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Pin, PinOff } from "@/components/icons/eywa-icon-compat";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { submitAction } from "@/components/forms/submit-action";
import {
  toggleStudentMemoPin,
  updateStudentMemo,
  type UpdateMemoState,
} from "@/features/students/server/actions";
import type { StudentMemoRow } from "@/features/students/server/queries";
import { DeleteMemoButton } from "./memo-delete-button";

const CATEGORIES = [
  { value: "general", label: "일반" },
  { value: "homework", label: "숙제/과제" },
  { value: "behavior", label: "행동" },
  { value: "parent", label: "학부모" },
  { value: "health", label: "건강" },
  { value: "other", label: "기타" },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);
const CATEGORY_COLOR: Record<string, string> = {
  general: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  homework: "bg-chart-2/10 text-chart-2 border-chart-2/20",
  behavior: "bg-chart-3/10 text-chart-3 border-chart-3/20",
  parent: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  health: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  other: "bg-muted text-muted-foreground border-border",
};

function PinButton({ memo, studentId }: { memo: StudentMemoRow; studentId: string }) {
  const [, action] = useActionState(toggleStudentMemoPin, undefined);
  const { pending } = useFormStatus();
  return (
    <form action={action}>
      <input type="hidden" name="id" value={memo.id} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="pinned" value={memo.pinned ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={memo.pinned ? "고정 해제" : "상단 고정"}
        className={`inline-flex items-center transition ${
          memo.pinned ? "text-gold" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {memo.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
    </form>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-chart-1 inline-flex items-center gap-1 text-[11px] font-medium"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      저장
    </button>
  );
}

export function MemoItem({ memo, studentId }: { memo: StudentMemoRow; studentId: string }) {
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  // 수정 폼 로컬 초안 — 신규작성(memo-form)엔 있는데 수정엔 없어 긴 메모를 고치다 리로드되면 유실됐다.
  const localDraft = useFormDraft({
    scope: `student-memo-edit:${memo.id}`,
    formRef,
    enabled: editing,
    exclude: ["id", "studentId"], // 서버 prop — IDB에 남길 이유가 없다
  });
  const [state, action] = useActionState<UpdateMemoState, FormData>(
    async (prev, formData) => {
      const res = await updateStudentMemo(prev, formData);
      if (res?.ok) {
        localDraft.clear();
        setEditing(false);
      }
      return res;
    },
    undefined,
  );

  return (
    <li
      className={`space-y-1.5 rounded-2xl border px-3 py-2.5 ${
        memo.pinned ? "border-gold/40 bg-gold/5" : "bg-card border-border"
      }`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
              CATEGORY_COLOR[memo.category] ?? CATEGORY_COLOR.other
            }`}
          >
            {CATEGORY_LABEL[memo.category] ?? memo.category}
          </span>
          {memo.createdByName ? (
            <span className="text-muted-foreground text-[11px]">{memo.createdByName}</span>
          ) : null}
          <span className="text-muted-foreground num text-[10px]">
            {new Date(memo.createdAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <PinButton memo={memo} studentId={studentId} />
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="수정"
              className="text-muted-foreground hover:text-foreground inline-flex items-center transition"
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          <DeleteMemoButton memoId={memo.id} studentId={studentId} />
        </div>
      </header>

      {editing ? (
        // submitAction: React 19 액션 폼 자동 리셋(#83) 회피 — 저장 실패 시 입력이 옛 값으로 돌아가지 않게.
        <form ref={formRef} onSubmit={(e) => submitAction(e, action)} className="space-y-2 pt-1">
          <DraftBanner
            savedAt={localDraft.draftSavedAt}
            onRestore={localDraft.restore}
            onDiscard={localDraft.discard}
          />
          <input type="hidden" name="id" value={memo.id} />
          <input type="hidden" name="studentId" value={studentId} />
          <select
            name="category"
            defaultValue={memo.category}
            className="border-border bg-card text-foreground rounded-lg border px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea
            name="content"
            required
            rows={3}
            defaultValue={memo.content}
            className="border-border bg-card text-foreground w-full rounded-lg border px-2 py-2 text-sm"
          />
          {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground text-[11px]"
            >
              취소
            </button>
            <SaveBtn />
          </div>
        </form>
      ) : (
        <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{memo.content}</p>
      )}
    </li>
  );
}
