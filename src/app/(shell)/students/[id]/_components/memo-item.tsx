"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Pin, PinOff } from "@/components/icons/aywa-icon-compat";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { submitAction } from "@/components/forms/submit-action";
import {
  toggleStudentMemoPin,
  updateStudentMemo,
  type UpdateMemoState,
} from "@/features/students/server/actions";
import type { StudentMemoRow } from "@/features/students/server/queries";
// 분류 목록·라벨·색은 단일 소스(여기에 복사본을 두지 말 것 — 그 복사가 '최근 메모'만 영문으로
// 남게 만든 원인이다).
import { MEMO_CATEGORIES, memoCategoryColor, memoCategoryLabel } from "@/features/students/detail/memo-category";
import { DeleteMemoButton } from "./memo-delete-button";

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

/** canWrite = 서버 고정·수정·삭제 게이트와 같은 판정(`canWriteTenant(role, "students")`). 읽기 권한이면 세 단추를 그리지 않는다. */
export function MemoItem({ memo, studentId, canWrite }: { memo: StudentMemoRow; studentId: string; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  // 수정 폼 로컬 초안 — 신규작성(memo-form)엔 있는데 수정엔 없어 긴 메모를 고치다 리로드되면 유실됐다.
  const localDraft = useFormDraft({
    scope: `student-memo-edit:${memo.id}`,
    formRef,
    enabled: editing,
    exclude: ["id", "studentId"], // 서버 prop — IDB에 남길 이유가 없다
  });
  // pending은 useActionState의 세 번째 값 — submitAction(수동 디스패치)에선 useFormStatus가 안 잡힌다
  // (class-form 선례: 스피너 없음 + 더블클릭 중복 제출).
  const [state, action, pending] = useActionState<UpdateMemoState, FormData>(
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
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${
              memoCategoryColor(memo.category)
            }`}
          >
            {memoCategoryLabel(memo.category)}
          </span>
          {memo.createdByName ? (
            <span className="text-muted-foreground text-xs">{memo.createdByName}</span>
          ) : null}
          <span className="text-muted-foreground num text-xs">
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
        {canWrite ? (
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
        ) : null}
      </header>

      {editing && canWrite ? (
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
            {MEMO_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {/* 검색 허용(0250a) — 작성 폼과 같은 이름·같은 뜻. 끄면 학생 검색에서 이 메모가 빠진다. */}
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              name="searchable"
              defaultChecked={memo.searchable}
              className="size-3.5 accent-[var(--primary)]"
            />
            검색 허용
          </label>
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
              // 취소 = 사용자가 명시적으로 버린 것 — 초안도 함께 지운다. 안 지우면 이 메모를 다시 열
              // 때마다 "작성하던 내용이 있습니다"가 뜨고, 복구하면 그 사이 바뀐 내용을 덮어쓴다
              // (스코프가 메모마다 하나라 그런 키가 계속 쌓이기도 한다 — 적대 리뷰 2026-08-18).
              onClick={() => {
                localDraft.discard();
                setEditing(false);
              }}
              className="text-muted-foreground text-xs"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={pending}
              className="text-chart-1 inline-flex items-center gap-1 text-xs font-medium"
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : null}
              저장
            </button>
          </div>
        </form>
      ) : (
        <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{memo.content}</p>
      )}
    </li>
  );
}
