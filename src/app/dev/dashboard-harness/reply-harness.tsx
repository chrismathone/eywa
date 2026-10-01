"use client";
import { ReplyThread } from "@/features/classnote-reply/components/reply-thread";
import type { useReplyThread } from "@/features/classnote-reply/components/use-reply-thread";
import type { ReplyContext } from "@/features/classnote-reply/reply-types";

const context: Extract<ReplyContext, { ok: true }> = {
  ok: true, message: { id: "sample", source: "post", content: "[영상] (내용 없이 첨부만)", boardName: "(수학)샘플", postedAt: "2026-10-01T01:30:00Z" },
  thread: [{ kind: "parent", messageId: "sample", source: "post", content: "[영상] (내용 없이 첨부만)", postedAt: null, focus: true, videos: [], photos: [], mediaNote: null }],
  canReply: true, reason: null, authorLabel: "샘플반 선생님", workerReady: true, maxLength: 1000,
  classnoteUrl: "https://www.classnote.com/service/report/123",
  reaction: { messageId: "sample", typeLabel: "확인했어요", statusLabel: "공감함", tone: "positive", pressed: true, busy: false, by: "샘플", error: null, errorRaw: null, canPress: false, canRemove: false },
};
const view: ReturnType<typeof useReplyThread> = { ctx: context, thread: context.thread, pending: false, note: null, run: async () => false };
/** 답글 발송 콜백은 실행하지 않는 개발 전용 레이아웃 점검. */
export function ReplyHarness() {
  return <div className="border-line m-2 flex h-[540px] max-w-[440px] flex-col gap-3 rounded-xl border p-3">
    <h1 className="font-bold">학부모 글에 답글 · 샘플</h1>
    <ReplyThread view={view} ctx={context} hideReaction={false} />
  </div>;
}
