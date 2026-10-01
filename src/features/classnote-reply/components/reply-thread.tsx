"use client";

import { useEffect, useRef } from "react";
import { requestParentReply, requestParentReplyDelete, requestParentReplyEdit } from "../server/reply-actions";
import type { ReplyContext } from "../reply-types";
import { useReactionControl } from "./reaction-control";
import { ReplyComposer } from "./reply-composer";
import { ReplyItem } from "./reply-item";
import { ThreadMedia } from "./thread-media";
import type { useReplyThread } from "./use-reply-thread";

export function kstDateTime(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

type Thread = ReturnType<typeof useReplyThread>;

/**
 * 답글 쓰레드 본문 — 학부모 글 → 같은 글의 학부모 댓글 → 우리 답글을 **시간순 한 줄기**로(각 답글은 상태 배지·수정·삭제 그대로), 맨 아래에 새 답글.
 * 답글 창의 두 껍데기(벨 오버레이·면 다이얼로그)가 이 한 벌을 쓴다. 스크롤 영역(쓰레드)과 고정 영역(공감·입력)을 나눠 그린다.
 */
export function ReplyThread({ view, ctx, hideReaction }: { view: Thread; ctx: Extract<ReplyContext, { ok: true }>; hideReaction: boolean }) {
  const { thread, pending, note, run } = view;
  const reaction = useReactionControl(hideReaction || ctx.hideReaction ? null : ctx.reaction);
  const actions = <>
    {ctx.classnoteUrl ? <a href={ctx.classnoteUrl} target="_blank" rel="noopener noreferrer" className="text-primary shrink-0 text-xs font-bold">ClassNote 이동 ↗</a> : null}
    <div className="min-w-0 [&>button]:max-w-full [&>button]:truncate [&>span]:block [&>span]:truncate">{reaction.trigger}</div>
  </>;
  const focusRef = useRef<HTMLLIElement | null>(null);
  const first = useRef(true);
  useEffect(() => {
    // 처음 열 때 지금 답글을 다는 글이 보이게 — 이후 갱신에서는 읽던 자리를 건드리지 않는다.
    if (!first.current) return;
    first.current = false;
    focusRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <>
      <ul className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-0.5" aria-label="이 글의 쓰레드">
        {thread.map((e) =>
          e.kind === "parent" ? (
            <li key={e.messageId} ref={e.focus ? focusRef : undefined} className={`rounded-lg p-3 ${e.focus ? "bg-bg-soft ring-primary/40 ring-1" : "bg-bg-soft/60"}`}>
              <div className="text-text-faint mb-1 flex flex-wrap items-center gap-x-2 text-xs">
                <span className="text-foreground font-bold">{e.source === "comment" ? "학부모 댓글" : "학부모 글"}</span>
                <span className="tabular-nums">{kstDateTime(e.postedAt)}</span>
                {e.focus ? <span className="text-primary font-bold">답글 대상</span> : null}
              </div>
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{e.content}</p>
              <ThreadMedia videos={e.videos} photos={e.photos} title={e.source === "comment" ? "학부모 댓글" : "학부모 글"} />
              {e.mediaNote ? <p className="text-text-dim mt-2 text-xs break-keep">{e.mediaNote}</p> : null}
            </li>
          ) : (
            <ReplyItem
              key={e.reply.id}
              reply={e.reply}
              pending={pending}
              onEdit={(body) => void run(() => requestParentReplyEdit({ replyId: e.reply.id, body }), { reload: true })}
              onDelete={() => void run(() => requestParentReplyDelete({ replyId: e.reply.id }), { reload: true })}
            />
          ),
        )}
      </ul>
      {/* 공감·입력·미리보기 — 줄지 않되 화면 높이의 45%를 넘으면 그 안에서 스크롤(낮은 화면에서 쓰레드가 0으로 접히거나 미리보기가 잘리지 않게). */}
      <div className="max-h-[45dvh] shrink-0 space-y-2 overflow-y-auto px-1 py-0.5">
        {ctx.canReply && ctx.authorLabel ? (
          <ReplyComposer
            authorLabel={ctx.authorLabel}
            maxLength={ctx.maxLength}
            pending={pending}
            actions={actions}
            actionPanel={reaction.panel}
            onSend={(body, clientKey) => run(() => requestParentReply({ messageId: ctx.message.id, body, clientKey }))}
          />
        ) : (
          <>
            <p className="text-text-dim text-xs break-keep">{ctx.reason ?? "지금은 답글을 쓸 수 없습니다"}</p>
            {reaction.panel}
            <div className="flex min-w-0 items-center gap-2" aria-label="답글 조작">{actions}</div>
          </>
        )}
        {note ? (
          <p role="status" className={`text-xs break-keep ${note.error ? "text-danger" : "text-text-dim"}`}>
            {note.text}
          </p>
        ) : null}
      </div>
    </>
  );
}
