"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AssistantLevel } from "@/features/assistant/levels";
import { clipText } from "@/features/assistant/text";
import {
  ASSISTANT_QUESTION_MAX,
  ASSISTANT_RUNNING_MS,
  type AskBody,
  type ThreadDetailResponse,
  type ThreadListResponse,
} from "@/features/assistant/protocol";
import {
  assistantReducer,
  currentConversation,
  initialAssistantState,
  isConversationStreaming,
  parseAskEvent,
  splitNdjson,
  threadKey,
  type AssistantState,
} from "./assistant-state";

const API = "/api/assistant";
/**
 * 서버가 아직 만드는 중인 답(다른 창에서 물은 질문 · 끊긴 뒤)을 다시 읽는 간격과 횟수 — 서버가 '도는 중'으로 보는 시간(15분)까지 잇는다
 * (3분에서 끊으면 늦게 끝난 답이 계속 도는 표시로 남았다 — 적대 리뷰 2026-11-06).
 */
const POLL_MS = 3000;
const POLL_MAX = Math.ceil(ASSISTANT_RUNNING_MS / POLL_MS) + 2;
/** `started`가 오기 전에 누른 멈춤을 이만큼 기다렸다가도 안 오면 '지금 도는 내 질문'으로 멈추고 끊는다. */
const STOP_WAIT_MS = 15_000;

/** 오류 응답(JSON `{ error }` · 한국어)의 문구 — 없으면 대신 쓸 말 + 상태 코드. */
async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      const msg = (body as { error: string }).error.trim();
      if (msg) return msg;
    }
  } catch {
    // 본문이 JSON이 아니다 — 대신 쓸 말로.
  }
  return `${fallback} (${res.status})`;
}

const OFFLINE = "인터넷 연결을 확인해 주세요.";
/** 이름 바꾸기 응답을 기다리는 시간. */
const RENAME_TIMEOUT_MS = 15_000;

/**
 * 서버에 '멈춤'을 알린다 — 번호로 보내고, 실패하면(세션 만료 · 500 · 망) '지금 도는 내 질문'(`current` — 사람당 하나)으로 한 번 더.
 * 번호가 없으면 바로 `current`. 끝까지 실패해도 화면은 끊는다(서버는 고정 기한 760초에 스스로 멈춘다).
 * `keepalive` — 판을 닫거나 화면을 옮겨도 요청이 끝까지 간다(재리뷰 2026-11-06).
 */
async function sendStop(messageId: string | null): Promise<void> {
  const post = async (id: string) => {
    try {
      return (await fetch(`${API}/messages/${encodeURIComponent(id)}/stop`, { method: "POST", cache: "no-store", keepalive: true })).ok;
    } catch {
      return false;
    }
  };
  if (messageId && (await post(messageId))) return;
  await post("current");
}

/**
 * 학원 비서 상태 + 그물 — 지난 대화 목록 · 대화 읽기 · 묻기(NDJSON 흐름) · 멈추기 · 지우기.
 * 🔑 이 훅은 **런처**에서 쓴다(셸 레이아웃에 붙어 화면 이동에도 살아 있다) — 오버레이를 닫아도 답을 계속 받는다.
 * 🔑 흐름이 `report`·`error` 없이 끊기면 서버는 끝까지 돌고 저장하므로 대화를 다시 읽는다(protocol.ts). 아직 도는 중이면 3초마다 다시 읽는다.
 */
export function useAssistant({ open }: { open: boolean }) {
  const [state, dispatch] = useReducer(assistantReducer, undefined, () => initialAssistantState("new:0"));
  const controllerRef = useRef<AbortController | null>(null);
  /** 지금 받는 질문의 번호(서버 `started` 이벤트) — '멈춤'이 서버에 알린다. */
  const messageIdRef = useRef<string | null>(null);
  /** `started` 전에 누른 '멈춤' — 서버는 아직 질문 번호를 주지 않았다. 번호를 받자마자 알리고 끊는다. */
  const stopPendingRef = useRef<number | null>(null);
  /** '멈추기'를 눌렀고 아직 흐름이 끝나지 않았다(버튼을 '멈추는 중'으로). */
  const [stopping, setStopping] = useState(false);
  const seqRef = useRef(1);
  const stateRef = useRef<AssistantState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 런처가 사라지면(로그아웃 등) 받던 흐름을 끊는다.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const nextKey = useCallback((prefix: string) => `${prefix}:${seqRef.current++}`, []);

  const loadThreads = useCallback(async () => {
    dispatch({ type: "threads/loading" });
    try {
      const res = await fetch(`${API}/threads`, { cache: "no-store" });
      if (!res.ok) return dispatch({ type: "threads/failed", error: await errorText(res, "지난 대화를 불러오지 못했습니다") });
      const body = (await res.json()) as ThreadListResponse;
      dispatch({ type: "threads/loaded", enabled: body.enabled !== false, threads: Array.isArray(body.threads) ? body.threads : [] });
    } catch {
      dispatch({ type: "threads/failed", error: OFFLINE });
    }
  }, []);

  /** 대화 하나를 서버 저장본으로 — `quiet`면 '불러오는 중'을 띄우지 않는다(이미 보이는 대화를 새로 고칠 때). */
  const loadConversation = useCallback(async (threadId: string, { quiet = false } = {}) => {
    const key = threadKey(threadId);
    if (!quiet) dispatch({ type: "conv/loading", key });
    try {
      const res = await fetch(`${API}/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
      if (!res.ok) return dispatch({ type: "conv/failed", key, error: await errorText(res, "대화를 불러오지 못했습니다") });
      const detail = (await res.json()) as ThreadDetailResponse;
      if (!detail?.thread || !Array.isArray(detail.messages)) return dispatch({ type: "conv/failed", key, error: "대화를 읽지 못했습니다." });
      dispatch({ type: "conv/loaded", key, detail });
    } catch {
      dispatch({ type: "conv/failed", key, error: OFFLINE });
    }
  }, []);

  const selectThread = useCallback(
    (threadId: string) => {
      const s = stateRef.current;
      const key = threadKey(threadId);
      const existing = s.conversations[key];
      dispatch({ type: "conv/select", threadId });
      // 답을 받는 중인 대화는 다시 읽지 않는다(로컬이 더 새롭다). 이미 본 대화는 보이는 채로 조용히 새로 고친다.
      if (existing && isConversationStreaming(s, existing)) return;
      void loadConversation(threadId, { quiet: existing?.load === "ready" });
    },
    [loadConversation],
  );

  const newConversation = useCallback(() => dispatch({ type: "conv/new", key: nextKey("new") }), [nextKey]);

  const ask = useCallback(
    async (input: { convKey: string; threadId: string | null; question: string; level: AssistantLevel }) => {
      const question = clipText(input.question.trim(), ASSISTANT_QUESTION_MAX);
      if (!question || controllerRef.current) return;
      const turnKey = nextKey("turn");
      const controller = new AbortController();
      controllerRef.current = controller;
      dispatch({
        type: "ask/start",
        convKey: input.convKey,
        turn: {
          key: turnKey,
          messageId: null,
          question,
          level: input.level,
          createdAt: new Date().toISOString(),
          status: "streaming",
          steps: [],
          queries: [],
          report: null,
          error: null,
        },
      });

      let threadId = input.threadId;
      /** 끝 이벤트(report·error)를 받았거나 이유가 확정됐나 — 아니면 끊긴 것이다. */
      let settled = false;
      try {
        const body: AskBody = { threadId, question, level: input.level };
        const res = await fetch(`${API}/ask`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          settled = true;
          dispatch({ type: "ask/failed", turnKey, error: await errorText(res, "질문을 보내지 못했습니다") });
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const handle = (line: string) => {
            const event = parseAskEvent(line);
            if (!event) return;
            if (event.type === "started") {
              messageIdRef.current = event.messageId;
              if (stopPendingRef.current !== null) {
                window.clearTimeout(stopPendingRef.current);
                stopPendingRef.current = null;
                void sendStop(event.messageId).finally(() => controller.abort());
              }
            }
            if (event.type === "thread") threadId = event.threadId;
            if (event.type === "report" || event.type === "error") settled = true;
            dispatch({ type: "ask/event", turnKey, event, now: new Date().toISOString() });
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { lines, rest } = splitNdjson(buffer);
            buffer = rest;
            lines.forEach(handle);
          }
          buffer += decoder.decode();
          if (buffer.trim()) handle(buffer.trim());
        }
      } catch {
        if (controller.signal.aborted) {
          settled = true;
          dispatch({ type: "ask/stopped", turnKey });
        }
      } finally {
        controllerRef.current = null;
        messageIdRef.current = null;
        if (stopPendingRef.current !== null) {
          window.clearTimeout(stopPendingRef.current);
          stopPendingRef.current = null;
        }
        setStopping(false);
        dispatch({ type: "ask/end", turnKey });
      }

      if (settled) return;
      // 끝 이벤트 없이 끊겼다 — 서버는 끝까지 돌고 저장한다. 대화가 이미 생겼으면 저장본을 읽는다(아직 도는 중이면 아래 polling이 잇는다).
      dispatch({ type: "ask/broken", turnKey });
      if (threadId) await loadConversation(threadId, { quiet: true });
      else dispatch({ type: "ask/failed", turnKey, error: "연결이 끊겼습니다. 다시 물어 주세요." });
    },
    [loadConversation, nextKey],
  );

  /**
   * 멈춤 — 서버에 먼저 알리고(연결만 끊으면 서버는 끝까지 돌고 저장한다 — 화면을 닫아도 답이 남게 일부러 그렇게 했다) **알림이 끝난 뒤** 흐름을 끊는다
   * (그 사이 '멈추는 중…' — 보내기 버튼이 풀리기 전에 서버가 멈춤 표시를 받아, 바로 다시 물어도 '앞 질문을 만드는 중'에 걸리지 않는다).
   * 서버는 2초 안에 알아채고(돌던 조회는 끝까지) '질문을 멈췄습니다'로 저장한다. 멈춘 질문은 바로 다시 물을 수 있다(store.ts admission).
   * 🔴 서버가 아직 질문 번호(`started`)를 주기 전이면 기다렸다가 번호가 오면 알린다 — 15초가 지나도 안 오면 '지금 도는 내 질문'으로(적대 리뷰 2026-11-06).
   */
  const stop = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    setStopping(true);
    const messageId = messageIdRef.current;
    if (messageId) {
      void sendStop(messageId).finally(() => controller.abort());
      return;
    }
    if (stopPendingRef.current !== null) return;
    stopPendingRef.current = window.setTimeout(() => {
      stopPendingRef.current = null;
      void sendStop(null).finally(() => controller.abort());
    }, STOP_WAIT_MS);
  }, []);

  /** 대화 지우기 — 실패하면 그 이유(한국어)를, 성공하면 null. */
  const deleteThread = useCallback(
    async (threadId: string): Promise<string | null> => {
      try {
        const res = await fetch(`${API}/threads/${encodeURIComponent(threadId)}`, { method: "DELETE", cache: "no-store" });
        if (!res.ok) return await errorText(res, "지우지 못했습니다");
        dispatch({ type: "thread/deleted", threadId, newKey: nextKey("new") });
        return null;
      } catch {
        return OFFLINE;
      }
    },
    [nextKey],
  );

  /** 대화 이름 바꾸기 — 실패하면 그 이유(한국어)를, 성공하면 null. 화면에는 서버가 정리한 이름을 쓴다. */
  const renameThread = useCallback(async (threadId: string, title: string): Promise<string | null> => {
    // 응답이 오지 않으면 15초에 끊는다 — 저장 중엔 Esc·취소가 막혀 편집 칸에 갇히지 않게(재리뷰 2026-11-09).
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), RENAME_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
        signal: timeout.signal,
      });
      if (!res.ok) return await errorText(res, "이름을 바꾸지 못했습니다");
      const body = (await res.json().catch(() => null)) as { title?: unknown } | null;
      dispatch({ type: "thread/renamed", threadId, title: typeof body?.title === "string" && body.title ? body.title : title.trim() });
      return null;
    } catch {
      return timeout.signal.aborted ? "응답이 없어 이름을 바꾸지 못했습니다. 다시 눌러 주세요." : OFFLINE;
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  // 서버가 아직 만드는 중인 답 — 보고 있는 동안 3초마다 '아직 도는지'만 묻고(`?status=1` — 가볍게), 끝났으면 대화 전체를 한 번 읽는다
  // (최대 15분 — 서버가 '도는 중'으로 보는 시간 · 매번 표·차트 자료까지 받지 않게 — 재리뷰 2026-11-06).
  const current = currentConversation(state);
  const pollThreadId =
    open && current.threadId && current.load !== "loading" && !isConversationStreaming(state, current) && current.turns.some((t) => t.status === "running" || t.status === "recovering")
      ? current.threadId
      : null;
  useEffect(() => {
    if (!pollThreadId) return;
    let count = 0;
    let busy = false;
    const id = window.setInterval(() => {
      count += 1;
      if (count > POLL_MAX) {
        window.clearInterval(id);
        // 마지막으로 한 번 전체를 읽는다 — 15분이 지났으면 서버는 그 줄을 '끝내지 못함'으로 보인다.
        void loadConversation(pollThreadId, { quiet: true });
        return;
      }
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const res = await fetch(`${API}/threads/${encodeURIComponent(pollThreadId)}?status=1`, { cache: "no-store" });
          const body = res.ok ? ((await res.json()) as { running?: unknown }) : null;
          if (body && body.running === false) await loadConversation(pollThreadId, { quiet: true });
        } catch {
          // 망이 잠깐 끊겼다 — 다음 차례에 다시.
        } finally {
          busy = false;
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [pollThreadId, loadConversation]);

  return { state, current, stopping, loadThreads, loadConversation, selectThread, newConversation, ask, stop, deleteThread, renameThread };
}
