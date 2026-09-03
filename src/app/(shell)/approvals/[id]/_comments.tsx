"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  addApprovalComment,
  deleteApprovalComment,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";
import { APPROVAL_TEXTAREA_CLASS, useResultToast } from "./_decide-panel";

/**
 * 문서 댓글 입력/삭제 — 하이웍스 개편 전자결재의 '댓글'(원장 2026-08-19: "결재 밑에 댓글처럼 있어서
 * 전결 이유나 여러가지 공유"). 목록은 서버(page.tsx)가 그리고, 여기는 쓰는 쪽만.
 * 본문은 컨트롤드 — 제출 자동 리셋([[#83]])에도 에러 시 입력이 남고, 성공 시에만 비운다.
 */

function SubmitCommentButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      등록
    </Button>
  );
}

export function CommentForm({ documentId }: { documentId: string }) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(
    addApprovalComment,
    undefined,
  );
  const [body, setBody] = useState("");
  useResultToast(state, () => setBody(""));

  return (
    <form action={action} className="flex items-start gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="댓글 — 전결 사유·보충 설명 등을 참여자와 공유합니다"
        className={`${APPROVAL_TEXTAREA_CLASS} min-w-0 flex-1`}
      />
      <SubmitCommentButton disabled={!body.trim()} />
    </form>
  );
}

function DeleteCommentButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-text-faint hover:text-danger shrink-0 text-xs transition"
    >
      삭제
    </button>
  );
}

/** 본인 댓글 삭제 — 자격(작성자 본인)은 서버 액션이 판정한다. */
export function CommentDeleteForm({ commentId }: { commentId: string }) {
  const [state, action] = useActionState<ApprovalActionState, FormData>(
    deleteApprovalComment,
    undefined,
  );
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="commentId" value={commentId} />
      <DeleteCommentButton />
    </form>
  );
}
