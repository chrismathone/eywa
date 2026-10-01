"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { kstDateTime, ReplyThread } from "./reply-thread";
import { useReplyThread } from "./use-reply-thread";

/**
 * 학부모 글·댓글 답글 창 — **가운데 다이얼로그판**(수업보고서 '학부모 글·답글' 면이 쓴다). 벨은 목록 위에 겹치는 오버레이판(`ParentReplyOverlay`)을 쓴다.
 * 내용은 같은 쓰레드(`ReplyThread`) — 원문·같은 글의 학부모 댓글·우리 답글(수정·삭제)·영상·공감·새 답글.
 * ⚠️ 호출부는 `key={messageId}`로 마운트할 것 — 다른 글을 열 때 이전 글의 상태가 남지 않게(effect 안 setState 금지, #25).
 */
export function ParentReplyDialog({ messageId, onClose, hideReaction = false }: {
  messageId: string | null;
  onClose: () => void;
  /** 공감 조작을 세우지 않는다 — 벨의 알림이 같은 문구의 댓글 둘 중 어느 것인지 가릴 수 없을 때(공감은 댓글 단위라 엉뚱한 댓글에 눌린다) */
  hideReaction?: boolean;
}) {
  const view = useReplyThread(messageId, hideReaction);
  const { ctx } = view;
  const ok = ctx?.ok ? ctx : null;
  return (
    <Dialog open={!!messageId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-lg">
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
          <ReplyThread view={view} ctx={ctx} hideReaction={hideReaction} />
        )}
      </DialogContent>
    </Dialog>
  );
}
