"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getParentReplyContext } from "../server/reply-actions";
import { getNotificationReplyContext } from "../server/notification-reply";
import type { ReplyActionResult, ReplyContext, ThreadEntry, ThreadVideo } from "../reply-types";

/** 연동 PC가 처리 중인 답글이 있으면 이 간격으로 다시 읽는다(지금 반 보드 동기화 버튼과 같은 10초). */
const POLL_MS = 10_000;
/** 영상이 아직 보관 중이면 이 간격으로 상태만 다시 본다(가벼운 GET). 10분 안에 안 끝나면 그만 묻는다(큰 영상은 압축·업로드가 길다 — 다시 열면 보인다). */
const VIDEO_POLL_MS = 8_000;
const VIDEO_POLL_MAX = 75;
/** 서버가 답하지 않으면 잠금을 푼다(폼이 영영 잠기지 않게, [[#102]]). 같은 clientKey라 다시 눌러도 한 행이다. */
const ACTION_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ACTION_TIMEOUT_MS))]);
}

/** 쓰레드에 폴링으로 받은 영상 상태를 덮어쓴다(메시지 id → 영상 목록). */
export function applyVideoOverrides(thread: ThreadEntry[], over: Record<string, ThreadVideo[]>): ThreadEntry[] {
  return thread.map((e) => (e.kind === "parent" && over[e.messageId] ? { ...e, videos: over[e.messageId]! } : e));
}

/**
 * 답글 창(벨 오버레이·'학부모 글·답글' 면 다이얼로그)이 같이 쓰는 상태 — 쓰레드 불러오기·요청 실행(잠금·시간 초과)·처리 중 답글 폴링·영상 보관 상태 폴링.
 * 🔴 영상 폴링은 서버 액션이 아니라 GET 라우트(`/api/classnote/reply-videos`)다 — 주기 호출은 라우터 작업 큐를 지나지 않게(#137).
 * ⚠️ 호출부는 `key={messageId}`로 마운트할 것 — 다른 글을 열 때 이전 글의 상태가 남지 않게(effect 안 setState 금지, #25).
 */
export function useReplyThread(initialMessageId: string | null, hideReaction: boolean, notificationId?: string) {
  const [ctx, setCtx] = useState<ReplyContext | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [videoOver, setVideoOver] = useState<Record<string, ThreadVideo[]>>({});
  const seqRef = useRef(0);

  const load = useCallback(async (id: string) => {
    const seq = ++seqRef.current;
    const res: ReplyContext = await (notificationId ? getNotificationReplyContext(notificationId) : getParentReplyContext(id, { noReaction: hideReaction }))
      .catch(() => ({ ok: false, error: "답글 정보를 불러오지 못했습니다" }));
    if (seq === seqRef.current) {
      setCtx(res);
      setVideoOver({}); // 새로 읽은 쓰레드가 가장 최신이다
    }
  }, [hideReaction, notificationId]);

  useEffect(() => {
    if (initialMessageId || notificationId) void load(initialMessageId ?? "");
  }, [initialMessageId, notificationId, load]);

  const messageId = ctx?.ok ? ctx.message.id : initialMessageId;
  const awaitingOriginal = ctx?.ok && ctx.awaitingOriginal === true;
  useEffect(() => {
    if (!notificationId || !awaitingOriginal) return;
    let polls = 0;
    const timer = setInterval(() => {
      if (++polls > VIDEO_POLL_MAX) return clearInterval(timer);
      void load("");
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [notificationId, awaitingOriginal, load]);

  const thread = useMemo(() => (ctx?.ok ? applyVideoOverrides(ctx.thread, videoOver) : []), [ctx, videoOver]);
  const busy = thread.some((e) => e.kind === "reply" && e.reply.busy);
  useEffect(() => {
    if (!messageId || !busy) return;
    const t = setInterval(() => void load(messageId), POLL_MS);
    return () => clearInterval(t);
  }, [messageId, busy, load]);

  const videoPending = thread.some((e) => e.kind === "parent" && e.videos.some((v) => v.pending));
  useEffect(() => {
    if (!messageId || !videoPending || awaitingOriginal) return;
    let n = 0;
    let alive = true;
    const t = setInterval(() => {
      if (++n > VIDEO_POLL_MAX) return clearInterval(t);
      fetch(`/api/classnote/reply-videos?messageId=${encodeURIComponent(messageId)}`, { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { videos?: Record<string, ThreadVideo[]> } | null) => {
          if (alive && j?.videos && Object.keys(j.videos).length) setVideoOver((prev) => ({ ...prev, ...j.videos }));
        })
        .catch(() => {});
    }, VIDEO_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [messageId, videoPending, awaitingOriginal]);

  /** `reload` = 응답의 컨텍스트 대신 이 글을 다시 읽는다(수정·삭제는 쓰레드의 다른 글에 달린 답글일 수 있어 응답 컨텍스트의 대상 글이 다르다). */
  const run = useCallback(async (fn: () => Promise<ReplyActionResult>, opts?: { reload?: boolean }): Promise<boolean> => {
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
      if (opts?.reload) reload();
      else setCtx((prev) => res.context.ok && prev?.ok ? { ...res.context, hideReaction: prev.hideReaction } : res.context);
      setNote({ text: res.message, error: false });
      return true;
    } catch {
      setNote({ text: "요청하지 못했습니다 — 잠시 뒤 다시 시도하세요", error: true });
      reload();
      return false;
    } finally {
      setPending(false);
    }
  }, [pending, messageId, load]);

  return { ctx, thread, pending, note, run };
}
