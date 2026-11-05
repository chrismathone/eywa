"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Pencil, Plus, Save, Trash2, Users, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import {
  createStudentGradeComment,
  deleteStudentGradeComment,
  updateStudentGradeComment,
  type GradeCommentState,
} from "@/features/students/server/actions";
import type { GradeCommentRow } from "@/features/students/server/queries";
import {
  COMMENT_CATEGORIES,
  commentCategoryMeta,
  currentPeriod,
} from "@/features/students/detail/grades-meta";
import { useSubjectMaps } from "@/features/owner/operations-context";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

function CommentDialog({
  studentId,
  editing,
  onClose,
}: {
  studentId: string;
  editing: GradeCommentRow | null;
  onClose: () => void;
}) {
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<GradeCommentState, FormData>(
    editing ? updateStudentGradeComment : createStudentGradeComment,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-bold">
            {editing ? "코멘트 수정" : "학습 코멘트 추가"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="studentId" value={studentId} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">카테고리</span>
              <select name="category" defaultValue={editing?.category ?? "general"} className={inputCls}>
                {COMMENT_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">과목</span>
              <select name="subject" defaultValue={editing?.subject ?? "all"} className={inputCls}>
                <option value="all">전체</option>
                {subjects.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">기간(월)</span>
            <input
              name="period"
              type="month"
              defaultValue={editing?.period ?? currentPeriod()}
              className={`${inputCls} num`}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">코멘트 *</span>
            <textarea
              name="content"
              rows={4}
              defaultValue={editing?.content ?? ""}
              className={`${inputCls} resize-y`}
              placeholder="학습 강점·보완점·노력·소견 등"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sharedWithParent"
              defaultChecked={editing?.sharedWithParent ?? false}
              className="size-4"
            />
            <span className="text-foreground">학부모와 공유</span>
          </label>

          {state?.error ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <SubmitBtn />
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteCommentBtn({ id, studentId }: { id: string; studentId: string }) {
  const [, action] = useActionState<GradeCommentState, FormData>(
    deleteStudentGradeComment,
    undefined,
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="studentId" value={studentId} />
      <button type="submit" className="text-muted-foreground hover:text-danger p-1" aria-label="삭제">
        <Trash2 className="size-3.5" />
      </button>
    </form>
  );
}

/**
 * canWrite = 서버 `requireGradeWrite`(students full|scoped)와 같은 판정 — page.tsx의 `canWriteTenant(role, "students")`.
 * 읽기 권한이면 '추가'·수정·삭제를 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export function GradeCommentsSection({
  studentId,
  comments,
  canWrite,
}: {
  studentId: string;
  comments: GradeCommentRow[];
  canWrite: boolean;
}) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GradeCommentRow | null>(null);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(c: GradeCommentRow) {
    setEditing(c);
    setOpen(true);
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-bold">학습 코멘트</h3>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus className="size-3.5" />
            추가
          </Button>
        ) : null}
      </header>

      {comments.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-2xl border border-dashed py-6 text-center text-xs">
          작성된 코멘트가 없습니다
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const meta = commentCategoryMeta(c.category);
            return (
              <li key={c.id} className="bg-card border-border rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={meta.color} soft>
                      {meta.label}
                    </Pill>
                    {c.subject ? (
                      <span className="text-text-dim text-xs font-medium">
                        {subjects.labelOf(c.subject)}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground num text-xs">{c.period}</span>
                    {c.sharedWithParent ? (
                      <span className="text-blue inline-flex items-center gap-0.5 text-xs font-medium">
                        <Users className="size-3" /> 공유
                      </span>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="text-muted-foreground hover:text-foreground p-1"
                        aria-label="수정"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <DeleteCommentBtn id={c.id} studentId={studentId} />
                    </div>
                  ) : null}
                </div>
                <p className="text-foreground mt-1.5 text-sm whitespace-pre-wrap">{c.content}</p>
                {c.authorName ? (
                  <p className="text-text-faint mt-1 text-xs">{c.authorName}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {open && canWrite ? (
        <CommentDialog studentId={studentId} editing={editing} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}
