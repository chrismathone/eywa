"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getParentReplyContext, requestParentReply, requestParentReplyDelete, requestParentReplyEdit } from "../server/reply-actions";
import type { ReplyActionResult, ReplyContext } from "../reply-types";
import { ReplyComposer } from "./reply-composer";
import { ReplyItem } from "./reply-item";

/** 연동 PC가 처리 중인 답글이 있으면 이 간격으로 다시 읽는다(지금 반 보드 동기화 버튼과 같은 10초). */
const POLL_MS = 10_000;
/** 서버가 답하지 않으면 잠금을 푼다(폼이 영영 잠기지 않게, [[#102]]). 같은 clientKey라 다시 눌러도 한 행이다. */
const ACTION_TIMEOUT_MS = 30_000;

function kstDateTime(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

function withTimeout<T>(p: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ACTION_TIMEOUT_MS))]);
}

/**
 * 학부모 글·댓글 답글 창(0317a) — 원문 · 이 글의 답글과 상태 · 쓰기(미리보기·확인·잠금). 벨과 수업보고서 '학부모 글' 면이 같이 쓴다.
 * ⚠️ 호출부는 `key={messageId}`로 마운트할 것 — 다른 글을 열 때 이전 글의 상태가 남지 않게(effect 안 setState 금지, #25).
 */
export function ParentReplyDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const [ctx, setCtx] = useState<ReplyContext | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async (id: string) => {
    const seq = ++seqRef.current;
    const res: ReplyContext = await getParentReplyContext(id).catch(() => ({ ok: false, error: "답글 정보를 불러오지 못했습니다" }));
    if (seq === seqRef.current) setCtx(res);
  }, []);

  useEffect(() => {
    if (messageId) void load(messageId);
  }, [messageId, load]);

  const busy = ctx?.ok ? ctx.replies.some((r) => r.busy) : false;
  useEffect(() => {
    if (!messageId || !busy) return;
    const t = setInterval(() => void load(messageId), POLL_MS);
    return () => clearInterval(t);
  }, [messageId, busy, load]);

  async function run(fn: () => Promise<ReplyActionResult>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setNote(null);
    seqRef.current++; // 진행 중인 폴링 응답이 방금 결과를 덮지 않게
    // 실패·시간 초과여도 서버는 받았을 수 있다 — 목록을 다시 읽어 **실제로 접수된 답글**을 보여 준다(모른 채 또 보내지 않게).
    const reload = () => {
      if (messageId) void load(messageId);
    };
    try {
      const res = await withTimeout(fn());
      if (res === "timeout") {
        setNote({ text: "응답이 늦습니다 — 위 목록에 답글이 보이면 접수된 것입니다(같은 내용을 다시 눌러도 한 건으로 처리됩니다)", error: true });
        reload();
        return false;
      }
      if (!res.ok) {
        setNote({ text: res.error, error: true });
        reload();
        return false;
      }
      setCtx(res.context);
      setNote({ text: res.message, error: false });
      return true;
    } catch {
      setNote({ text: "요청하지 못했습니다 — 잠시 뒤 다시 시도하세요", error: true });
      reload();
      return false;
    } finally {
      setPending(false);
    }
  }

  const ok = ctx?.ok ? ctx : null;
  return (
    <Dialog open={!!messageId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>학부모 {ok?.message.source === "comment" ? "댓글" : "글"}에 답글</DialogTitle>
          <DialogDescription>
            {ok ? [ok.message.boardName, kstDateTime(ok.message.postedAt)].filter(Boolean).join(" · ") : "ClassNote 그 글에 댓글로 올라갑니다"}
          </DialogDescription>
        </DialogHeader>
        {!ctx ? (
          <p className="text-text-dim text-sm">불러오는 중…</p>
        ) : !ctx.ok ? (
          <p className="text-danger text-sm">{ctx.error}</p>
        ) : (
          <div className="space-y-3">
            <blockquote className="bg-bg-soft text-foreground rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
              {ctx.message.content}
            </blockquote>
            {ctx.replies.length ? (
              <ul className="space-y-2" aria-label="이 글의 답글">
                {ctx.replies.map((r) => (
                  <ReplyItem
                    key={r.id}
                    reply={r}
                    pending={pending}
                    onEdit={(body) => void run(() => requestParentReplyEdit({ replyId: r.id, body }))}
                    onDelete={() => void run(() => requestParentReplyDelete({ replyId: r.id }))}
                  />
                ))}
              </ul>
            ) : null}
            {ctx.canReply && ctx.authorLabel ? (
              <ReplyComposer
                authorLabel={ctx.authorLabel}
                maxLength={ctx.maxLength}
                pending={pending}
                onSend={(body, clientKey) => run(() => requestParentReply({ messageId: ctx.message.id, body, clientKey }))}
              />
            ) : (
              <p className="text-text-dim text-xs break-keep">{ctx.reason ?? "지금은 답글을 쓸 수 없습니다"}</p>
            )}
            {note ? (
              <p role="status" className={`text-xs break-keep ${note.error ? "text-danger" : "text-text-dim"}`}>
                {note.text}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
