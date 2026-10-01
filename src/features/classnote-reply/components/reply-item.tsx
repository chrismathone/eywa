"use client";

import { useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toneColor } from "@/lib/design/semantic-color";
import { REPLY_BODY_MAX } from "../reply-policy";
import type { ReplyView } from "../reply-types";

function kstShort(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

/**
 * 답글 한 줄 — 상태 배지(의미색) · 게시 명의 · 본문 · 실패 사유(한글, 원문은 툴팁) · 수정/삭제(본인 또는 관리자급).
 * 🔒 보내는 동안(`pending`) 버튼을 잠근다 — 재클릭 중복 요청 방지(e78883dbf와 같은 규약: 화면 잠금 + 서버 조건부 쓰기).
 */
export function ReplyItem({
  reply,
  pending,
  onEdit,
  onDelete,
}: {
  reply: ReplyView;
  pending: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = pending || reply.busy;

  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill color={toneColor(reply.tone)}>{reply.statusLabel}</Pill>
        <span className="text-foreground text-xs font-bold">{reply.authorLabel}</span>
        <span className="text-text-faint text-xs tabular-nums">{kstShort(reply.editedAt ?? reply.createdAt)}</span>
        {reply.historyCount > 0 ? <span className="text-text-faint text-xs">수정 {reply.historyCount}회(원문 보관)</span> : null}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={REPLY_BODY_MAX}
            rows={4}
            className="border-line bg-background focus-visible:outline-primary w-full rounded-lg border p-2 text-sm leading-relaxed"
            aria-label="답글 수정"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-text-faint mr-auto text-xs tabular-nums">{draft.trim().length}/{REPLY_BODY_MAX}</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(false); setDraft(reply.body); }}>
              취소
            </Button>
            <Button type="button" size="sm" disabled={pending || !draft.trim() || draft.trim() === reply.body} onClick={() => { onEdit(draft); setEditing(false); }}>
              {pending ? "요청 중…" : "수정 요청"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{reply.body}</p>
      )}
      {reply.pendingBody && reply.busy ? (
        <p className="text-text-dim mt-1 text-xs whitespace-pre-wrap">고칠 내용: {reply.pendingBody}</p>
      ) : null}
      {reply.error ? (
        <p className="text-danger mt-1 text-xs break-keep" title={reply.errorRaw ?? undefined}>
          {reply.error}
        </p>
      ) : null}

      {reply.canChange && !editing ? (
        <div className="mt-2 flex items-center justify-end gap-1">
          <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => { setDraft(reply.body); setEditing(true); }}>
            수정
          </Button>
          <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => setConfirmDelete(true)}>
            삭제
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="답글 삭제"
        message={reply.notPosted ? "아직 ClassNote에 올라가지 않은 답글을 취소합니다." : "ClassNote에 올라간 이 댓글을 지웁니다. 학부모가 이미 읽었을 수 있습니다."}
        confirmLabel="삭제"
        danger
        onConfirm={() => { setConfirmDelete(false); onDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}
