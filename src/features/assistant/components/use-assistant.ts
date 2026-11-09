"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  canStartIn,
  currentConversation,
  initialAssistantState,
  isConversationStreaming,
  parseAskEvent,
  splitNdjson,
  staleRunningThreadIds,
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
/** `started`가 오기 전에 누른 멈춤을 이만큼 기다렸다가도 안 오면 화면이 만든 번호(clientRef)로 멈추고 끊는다. */
const STOP_WAIT_MS = 15_000;
/** 그래도 서버가 그 질문을 못 찾았으면(아직 줄이 없다) 번호가 오기를 이만큼 더 기다린 뒤 끊는다(그사이 번호가 오면 그 번호로 멈춘다). */
const STOP_GIVE_UP_MS = 45_000;
/**
 * 다른 탭·기기에서 도는 대화가 목록에 있으면, 판이 열린 동안 이 간격으로 목록을 다시 읽는다 — 끝난 대화의 '도는 중'을 풀어
 * 동시 자리 수(3개)가 실제와 맞게(원장 2026-11-06 *"정상적인 동작으로 인식되게"*).
 */
const LIST_POLL_MS = 15_000;

/** 오류 응답(JSON `{ error, code? }` · 한국어)의 문구와 종류 — 없으면 대신 쓸 말 + 상태 코드. */
async function errorBody(res: Response, fallback: string): Promise<{ message: string; code: string | null }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { error, code } = body as { error?: unknown; code?: unknown };
      const msg = typeof error === "string" ? error.trim() : "";
      if (msg) return { message: msg, code: typeof code === "string" ? code : null };
    }
  } catch {
    // 본문이 JSON이 아니다 — 대신 쓸 말로.
  }
  return { message: `${fallback} (${res.status})`, code: null };
}

async function errorText(res: Response, fallback: string): Promise<string> {
  return (await errorBody(res, fallback)).message;
}

const OFFLINE = "인터넷 연결을 확인해 주세요.";
/** 이름 바꾸기 응답을 기다리는 시간. */
const RENAME_TIMEOUT_MS = 15_000;

/** 질문 하나의 손잡이 — 흐름 끊기 · 질문 번호 · 화면이 만든 번호 · 번호를 받기 전에 누른 멈춤/마무리 · 지금 어느 대화인지. */
type Run = {
  controller: AbortController;
  messageId: string | null;
  clientRef: string;
  /** 번호(`started`)를 받기 전에 누른 멈춤을 기다리는 타이머. */
  stopTimer: number | null;
  /** 멈춤을 눌렀다 — 번호가 오면(언제든) 그 번호로 알리고 끊는다(타이머 상태와 따로 · 재리뷰 2026-11-09). */
  stopRequested: boolean;
  finishPending: boolean;
  convKey: string;
  threadId: string | null;
};

/** 서버가 그 질문을 찾아 표시했나(`{ ok: true }`) — 이미 끝났거나 아직 줄이 없으면 false. */
async function post(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "POST", cache: "no-store", keepalive: true });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * 서버에 '멈춤'·'바로 결과 보기'를 알린다 — 질문 번호로, 실패하면(세션 만료 · 500 · 망 · 번호 없음) 화면이 만든 번호(`?by=ref`)로 한 번 더.
 * `keepalive` — 판을 닫거나 화면을 옮겨도 요청이 끝까지 간다(재리뷰 2026-11-06).
 */
async function sendControl(action: "stop" | "finish", run: Pick<Run, "messageId" | "clientRef">): Promise<boolean> {
  if (run.messageId && (await post(`${API}/messages/${encodeURIComponent(run.messageId)}/${action}`))) return true;
  return post(`${API}/messages/${encodeURIComponent(run.clientRef)}/${action}?by=ref`);
}

function mark(set: Dispatch<SetStateAction<ReadonlySet<string>>>, key: string, on: boolean) {
  set((prev) => {
    if (prev.has(key) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });
}

/**
 * 학원 비서 상태 + 그물 — 지난 대화 목록 · 대화 읽기 · 묻기(NDJSON 흐름) · 멈추기 · 바로 결과 보기 · 지우기.
 * 🔑 이 훅은 **런처**에서 쓴다(셸 레이아웃에 붙어 화면 이동에도 살아 있다) — 오버레이를 닫아도 답을 계속 받는다.
 * 🔑 흐름이 `report`·`error` 없이 끊기면 서버는 끝까지 돌고 저장하므로 대화를 다시 읽는다(protocol.ts). 아직 도는 중이면 3초마다 다시 읽는다.
 * 🔑 동시에 3개까지(대화마다 하나 · 원장 2026-11-06) — 질문마다 손잡이(`Run`)를 따로 든다. 멈춤·마무리는 차례(turnKey)로 고른다.
 */
export function useAssistant({ open }: { open: boolean }) {
  const [state, dispatch] = useReducer(assistantReducer, undefined, () => initialAssistantState("new:0"));
  const runs = useRef(new Map<string, Run>());
  /** '멈추기'를 눌렀고 아직 흐름이 끝나지 않은 차례(버튼을 '멈추는 중'으로). */
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());
  /** '바로 결과 보기'를 눌렀고 보고서를 기다리는 차례. */
  const [finishing, setFinishing] = useState<ReadonlySet<string>>(() => new Set());
  const seqRef = useRef(1);
  const stateRef = useRef<AssistantState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 런처가 사라지면(로그아웃 등) 받던 흐름을 모두 끊는다.
  useEffect(() => {
    const live = runs.current;
    return () => {
      for (const r of live.values()) r.controller.abort();
    };
  }, []);

  const nextKey = useCallback((prefix: string) => `${prefix}:${seqRef.current++}`, []);

  const loadThreads = useCallback(async () => {
    dispatch({ type: "threads/loading" });
    // 읽기 시작할 때의 지우기·이름 바꾸기 순번 — 그 뒤의 변경은 늦게 온 목록 위에 다시 얹는다.
    const since = stateRef.current.editSeq;
    try {
      const res = await fetch(`${API}/threads`, { cache: "no-store" });
      if (!res.ok) return dispatch({ type: "threads/failed", error: await errorText(res, "지난 대화를 불러오지 못했습니다") });
      const body = (await res.json()) as ThreadListResponse;
      dispatch({ type: "threads/loaded", enabled: body.enabled !== false, threads: Array.isArray(body.threads) ? body.threads : [], since });
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
      if (!res.ok) return dispatch({ type: "conv/failed", key, error: await errorText(res, "대화를 불러오지 못했습니다"), gone: res.status === 404 });
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

  /**
   * 묻기 — 이 대화가 도는 중이거나 자리가 찼으면 보내지 않는다(화면이 먼저 막는다).
   * 서버가 자리 없음·같은 대화 도는 중(`code: "busy"`)으로 받지 않으면 보낸 차례를 거두고 `onBusy`로 알린다(실패 카드가 아니라 안내 —
   * 화면이 보낸 글을 입력칸에 되돌린다 · 원장 2026-11-06 *"정상적인 동작으로 인식되게"*). 다른 탭에서 도는 대화를 알게 목록도 다시 읽는다.
   */
  const ask = useCallback(
    async (input: { convKey: string; threadId: string | null; question: string; level: AssistantLevel; onBusy?: (message: string) => void }) => {
      const question = clipText(input.question.trim(), ASSISTANT_QUESTION_MAX);
      if (!question) return;
      const s = stateRef.current;
      const conv = s.conversations[input.convKey];
      if (!conv || !canStartIn(s, conv)) return;
      // 같은 틱에 두 번 눌러도(상태가 아직 안 바뀌었다) 같은 대화에는 하나만 — 손잡이는 바로 생긴다.
      for (const r of runs.current.values()) {
        if (r.convKey === input.convKey || (input.threadId && r.threadId === input.threadId)) return;
      }
      const turnKey = nextKey("turn");
      const run: Run = {
        controller: new AbortController(),
        messageId: null,
        clientRef: crypto.randomUUID(),
        stopTimer: null,
        stopRequested: false,
        finishPending: false,
        convKey: input.convKey,
        threadId: input.threadId,
      };
      runs.current.set(turnKey, run);
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
        const body: AskBody = { threadId, question, level: input.level, clientRef: run.clientRef };
        const res = await fetch(`${API}/ask`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify(body),
          signal: run.controller.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          settled = true;
          const err = await errorBody(res, "질문을 보내지 못했습니다");
          if (err.code === "busy") {
            dispatch({ type: "ask/rejected", turnKey });
            input.onBusy?.(err.message);
            void loadThreads();
          } else {
            dispatch({ type: "ask/failed", turnKey, error: err.message });
          }
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const handle = (line: string) => {
            const event = parseAskEvent(line);
            if (!event) return;
            if (event.type === "started") {
              run.messageId = event.messageId;
              if (run.stopRequested) {
                // 화면 번호로 보낸 멈춤이 오가는 사이에 번호가 와도 놓치지 않는다 — 번호로 한 번 더(겹쳐도 해롭지 않다).
                if (run.stopTimer !== null) window.clearTimeout(run.stopTimer);
                run.stopTimer = null;
                void sendControl("stop", run).finally(() => run.controller.abort());
              } else if (run.finishPending) {
                run.finishPending = false;
                void sendControl("finish", run);
              }
            }
            if (event.type === "thread") {
              threadId = event.threadId;
              run.threadId = event.threadId;
              run.convKey = threadKey(event.threadId);
            }
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
        if (run.controller.signal.aborted) {
          settled = true;
          dispatch({ type: "ask/stopped", turnKey });
        }
      } finally {
        runs.current.delete(turnKey);
        if (run.stopTimer !== null) window.clearTimeout(run.stopTimer);
        mark(setStopping, turnKey, false);
        mark(setFinishing, turnKey, false);
        dispatch({ type: "ask/end", turnKey });
      }

      if (settled) return;
      // 끝 이벤트 없이 끊겼다 — 서버는 끝까지 돌고 저장한다. 대화가 이미 생겼으면 저장본을 읽는다(아직 도는 중이면 아래 polling이 잇는다).
      dispatch({ type: "ask/broken", turnKey });
      if (threadId) await loadConversation(threadId, { quiet: true });
      else dispatch({ type: "ask/failed", turnKey, error: "연결이 끊겼습니다. 다시 물어 주세요." });
    },
    [loadConversation, loadThreads, nextKey],
  );

  /**
   * 멈춤(그 차례) — 서버에 먼저 알리고(연결만 끊으면 서버는 끝까지 돌고 저장한다 — 화면을 닫아도 답이 남게 일부러 그렇게 했다) **알림이 끝난 뒤**
   * 흐름을 끊는다(그 사이 '멈추는 중…' — 보내기 버튼이 풀리기 전에 서버가 멈춤 표시를 받아, 바로 다시 물어도 '앞 질문을 만드는 중'에 걸리지 않는다).
   * 서버는 2초 안에 알아채고(돌던 조회는 끝까지) '질문을 멈췄습니다'로 저장한다. 멈춘 질문은 자리를 바로 비운다(s2_0034 색인 조건).
   * 🔴 서버가 아직 질문 번호(`started`)를 주기 전이면 기다렸다가 번호가 오면 알린다 — 15초가 지나도 안 오면 화면이 만든 번호로(적대 리뷰 2026-11-06).
   */
  const stop = useCallback((turnKey: string) => {
    const run = runs.current.get(turnKey);
    if (!run) return;
    mark(setStopping, turnKey, true);
    const already = run.stopRequested;
    run.stopRequested = true;
    if (run.messageId) {
      void sendControl("stop", run).finally(() => run.controller.abort());
      return;
    }
    if (already || run.stopTimer !== null) return;
    run.stopTimer = window.setTimeout(() => {
      run.stopTimer = null;
      // 화면이 만든 번호로 — 서버 줄이 아직 없으면(시작 준비가 길다) 끊지 않고 번호를 더 기다린다: 끊으면 서버만 끝까지 돌며 자리를 차지한다(적대 리뷰 2026-11-09).
      void sendControl("stop", run).then((ok) => {
        if (ok) run.controller.abort();
        else if (!run.controller.signal.aborted) run.stopTimer = window.setTimeout(() => run.controller.abort(), STOP_GIVE_UP_MS);
      });
    }, STOP_WAIT_MS);
  }, []);

  /**
   * 이 화면이 받지 않는 질문(다른 탭·기기에서 물었거나 새로 고친 뒤 — 저장본의 '도는 중')을 멈추거나 바로 결과 보기 — 질문 번호로 알린다.
   * 다른 곳에서 자리 3개를 쥔 질문을 여기서도 풀 수 있게(적대 리뷰 2026-11-09). 서버가 2초 안에 알아채고, 끝나면 3초 다시 읽기가 결과를 가져온다.
   */
  const controlSaved = useCallback(async (action: "stop" | "finish", messageId: string): Promise<boolean> => {
    return post(`${API}/messages/${encodeURIComponent(messageId)}/${action}`);
  }, []);

  /**
   * '여기서 끝내고 결과 보기'(그 차례 · 원장 2026-11-06 *"조회 멈추고, 지금까지 조회한 내용으로만 결과 출력"*) — 질문을 버리지 않는다.
   * 서버가 2초 안에 알아채고 더 조회하지 않고 보고서를 쓴다 — 흐름은 그대로 받아 보고서가 이 자리에 뜬다.
   * 질문 번호 전이면 화면이 만든 번호로 먼저 보내고, 줄이 아직 없었으면 번호가 오는 대로 다시 보낸다.
   */
  const finish = useCallback((turnKey: string) => {
    const run = runs.current.get(turnKey);
    if (!run) return;
    mark(setFinishing, turnKey, true);
    if (run.messageId) {
      // 서버가 그 질문을 찾지 못했다(이미 끝남 · 망) — 다시 누를 수 있게 푼다.
      void sendControl("finish", run).then((ok) => {
        if (!ok && runs.current.has(turnKey)) mark(setFinishing, turnKey, false);
      });
      return;
    }
    run.finishPending = true;
    void sendControl("finish", run).then((ok) => {
      if (ok) run.finishPending = false;
    });
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

  // 다른 탭·기기에서 도는 대화(이 화면이 받지 않는 것)가 목록에 있거나, 저장본이 '도는 중'인 대화를 두고 다른 대화로 옮겼으면 —
  // 판이 열린 동안 목록과 그 대화들을 다시 읽어 끝난 것을 푼다(안 그러면 끝난 대화가 자리를 계속 센다 · 적대 리뷰 2026-11-09).
  const stale = open ? staleRunningThreadIds(state) : [];
  const staleKey = stale.join(",");
  const remoteRunning =
    open &&
    (stale.length > 0 ||
      state.threads.some((t) => {
        if (!t.running) return false;
        const conv = state.conversations[threadKey(t.id)];
        return !conv || !isConversationStreaming(state, conv);
      }));
  useEffect(() => {
    if (!remoteRunning) return;
    const ids = staleKey ? staleKey.split(",") : [];
    const id = window.setInterval(() => {
      void loadThreads();
      for (const threadId of ids) {
        void (async () => {
          try {
            const res = await fetch(`${API}/threads/${encodeURIComponent(threadId)}?status=1`, { cache: "no-store" });
            const body = res.ok ? ((await res.json()) as { running?: unknown }) : null;
            if (body && body.running === false) await loadConversation(threadId, { quiet: true });
          } catch {
            // 망이 잠깐 끊겼다 — 다음 차례에 다시.
          }
        })();
      }
    }, LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [remoteRunning, staleKey, loadThreads, loadConversation]);

  return {
    state,
    current,
    stopping,
    finishing,
    loadThreads,
    loadConversation,
    selectThread,
    newConversation,
    ask,
    stop,
    finish,
    controlSaved,
    deleteThread,
    renameThread,
  };
}
