"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Dialog } from "@base-ui/react/dialog";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSISTANT_MAX_RUNNING } from "@/features/assistant/protocol";
import { monthDayLabel } from "@/lib/date-kst";
import { isConversationRunningElsewhere, liveTurnOf, runningThreadKeys, type Conversation, type Turn } from "./assistant-state";
import { AdviceList } from "./advice-list";
import { AssistantComposer } from "./assistant-composer";
import { AssistantThreadList } from "./assistant-thread-list";
import { AssistantTurn } from "./assistant-turn";
import type { useAssistant } from "./use-assistant";
import { useAssistantSuggestions } from "./use-assistant-suggestions";

type Assistant = ReturnType<typeof useAssistant>;

const PHONE = "(max-width: 767.98px)";
const isPhone = () => window.matchMedia(PHONE).matches;
/** 대화 상자의 마지막 질문을 맨 위로(질문이 없으면 맨 위로). */
function scrollLastTurnIntoView(box: HTMLElement | null, behavior: ScrollBehavior) {
  const turns = box?.querySelectorAll<HTMLElement>("[data-turn]");
  const last = turns?.[turns.length - 1];
  if (last) last.scrollIntoView({ block: "start", behavior });
  else box?.scrollTo({ top: 0 });
}
const scrollBehavior = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/**
 * 학원 비서 오버레이 — 어느 화면 위에서나 오른쪽에서 열리는 넓은 판(약 1120px · 전체 화면으로 키울 수 있다 · 폰은 늘 전체 화면).
 * 왼쪽 지난 대화(접힘 · 폰은 서랍) · 가운데 대화(질문 + 보고서) · 아래 입력.
 *
 * 🔑 z-[80] — 셸 머리(z-60)·공지 팝업(z-55)·드롭다운(z-60) 위, 카드 툴팁 레이어(z-9999) 아래.
 *    🔴 그래서 판 안에는 **포털로 뜨는 공용 팝업**(ui/tooltip z-50 · dropdown-menu·select z-60)을 쓰지 않는다 — 판 뒤에 깔린다.
 * 🔑 판은 최상위 문서에만 있다(창 = iframe 위에 덮인다). 상태는 런처가 든다 — 닫아도 대화·받던 답이 그대로다.
 */
export function AssistantOverlay({
  open,
  onOpenChange,
  keepMounted,
  finalFocus,
  assistant,
  draft,
  onDraftChange,
  expanded,
  onExpandedChange,
  listOpen,
  onListOpenChange,
  today,
  hotkeyLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 한 번 연 뒤로는 닫아도 DOM을 남긴다(스크롤·입력 중인 글·차트가 그대로). */
  keepMounted: boolean;
  /** 닫을 때 초점을 돌려줄 곳(검색 팰릿으로 넘어갈 땐 false). */
  finalFocus: () => boolean | HTMLElement | null;
  assistant: Assistant;
  draft: string;
  onDraftChange: (v: string) => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  listOpen: boolean;
  onListOpenChange: (v: boolean) => void;
  today: string;
  hotkeyLabel: string;
}) {
  const { state, current } = assistant;
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 지울지 묻는 중인 대화(목록 행의 x — 원장 2026-11-06). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 이름을 고치는 중인 대화(원장 2026-11-06 *"대화 이름 변경도 가능하게"*) — Esc는 이것부터 닫는다. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 이름을 저장하는 중인 대화 — 그 대화의 편집 칸은 Esc로 닫지 않는다(결과·실패 이유를 기다린다 · 재리뷰 2026-11-09). 다른 대화의 편집 칸은 막지 않는다. */
  const renameSavingFor = useRef<string | null>(null);
  /** 가운데에 '지난 의견'(대화를 넘나든 의견 모음 · 3단계 2026-11-10)을 보이는 중 — 대화는 감춰 둔 채 그대로(스크롤·입력 유지). */
  const [showAdvice, setShowAdvice] = useState(false);
  /** 이 판에서 지운 대화 — '지난 의견'이 다시 읽기를 기다리지 않고 그 대화의 의견을 바로 뺀다(다시 읽기가 실패해도 남지 않게 · 재리뷰 2026-11-10). */
  const [deletedThreads, setDeletedThreads] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * 서버가 자리 없음으로 받지 않은 질문의 안내 — 그 대화에서만, 목록을 다시 읽기 전까지만 보인다(받지 않으면 목록을 다시 읽는다 — 그 뒤엔
   * 목록이 진실이라 막힘 까닭은 `blockedReason`이 말하고, 자리가 나면 저절로 풀린다 · 재리뷰 2026-11-09).
   */
  const [busyNotice, setBusyNotice] = useState<{ key: string; text: string; seq: number } | null>(null);
  /** 지금 보는 대화 — 받지 않은 질문의 글을 되돌릴 때 그사이 다른 대화로 옮겼으면 그 입력칸에 넣지 않게(적대 리뷰 2026-11-09). */
  const currentKeyRef = useRef(current.key);
  useEffect(() => {
    currentKeyRef.current = current.key;
  }, [current.key]);
  /** 지금 입력칸의 글 — 받지 않은 질문을 되돌릴 때 그사이 새로 쓴 글을 덮지 않게. */
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // 동시에 3개까지 · 대화마다 하나(원장 2026-11-06). 다른 탭·기기에서 도는 대화도 센다(목록 `running` · 저장본 '도는 중').
  const live = liveTurnOf(state, current);
  const streamingHere = live !== null;
  const elsewhereHere = isConversationRunningElsewhere(state, current);
  const running = runningThreadKeys(state);
  const threadsSeqRef = useRef(state.threadsSeq);
  useEffect(() => {
    threadsSeqRef.current = state.threadsSeq;
  }, [state.threadsSeq]);
  /** 지우기 확인 — 그사이 답을 만들기 시작한 대화의 확인은 없는 것으로 본다(감춘 확인이 Esc를 먹지 않게 · 재리뷰 2026-11-09). */
  const confirmDeleteLive = confirmDelete && !running.has(confirmDelete) ? confirmDelete : null;
  const full = !streamingHere && !elsewhereHere && running.size >= ASSISTANT_MAX_RUNNING;
  const blockedReason =
    state.enabled === false
      ? "이 지점에서는 학원 비서를 쓸 수 없습니다."
      : elsewhereHere
        ? "이 대화는 아직 앞 질문의 답을 만드는 중입니다. 끝나면 이어서 물을 수 있고, 다른 질문은 새 대화에서 물어보세요."
        : full
          ? `답은 동시에 ${ASSISTANT_MAX_RUNNING}개까지 만들 수 있습니다. 하나가 끝나면 보낼 수 있습니다.`
          : null;
  const canAskHere = !blockedReason && !streamingHere;
  // '바로 결과 보기'는 자료를 하나라도 읽은 뒤 — 조회를 마쳤거나 전수 조회를 시작했다(센 데까지 보고서에 쓴다).
  // 표 구조만 본 단계(schema)는 자료가 아니다 — 근거 없이 보고서를 쓰지 않게(적대 리뷰 2026-11-09).
  const canFinish = !!live?.steps.some((st) => (st.kind === "query" && st.state === "done") || st.kind === "survey");

  const scrollToLastTurn = (behavior: ScrollBehavior) => scrollLastTurnIntoView(scrollRef.current, behavior);

  // 다른 대화를 열었거나 저장본이 도착하면 마지막 질문을 맨 위에(긴 보고서의 끝이 아니라 시작이 보이게).
  const readyKey = current.load === "ready" ? current.key : null;
  useEffect(() => {
    if (readyKey) scrollLastTurnIntoView(scrollRef.current, "auto");
  }, [readyKey]);

  const closeListOnPhone = () => {
    if (isPhone()) setListOpen(false);
  };

  /**
   * 서버가 자리 없음·같은 대화 도는 중으로 받지 않았다 — 실패 카드 대신 입력칸 아래 안내 + 보낸 글을 입력칸에 되돌린다
   * (그사이 새로 쓴 글이 있으면 그대로 둔다 · 원장 2026-11-06 *"정상적인 동작으로 인식되게"*).
   */
  const onBusy = (convKey: string, question: string) => (message: string) => {
    if (currentKeyRef.current === convKey && !draftRef.current.trim()) onDraftChange(question);
    setBusyNotice({ key: convKey, text: message, seq: threadsSeqRef.current });
  };

  const send = (text: string, fromDraft: boolean) => {
    const question = text.trim();
    if (!question || !canAskHere) return;
    if (fromDraft) onDraftChange("");
    setBusyNotice(null);
    // 이 대화의 지우기 확인을 열어 둔 채 물으면 확인은 닫는다(답이 끝난 뒤 되살아나 초점을 빼앗지 않게).
    if (confirmDelete && confirmDelete === current.threadId) setConfirmDelete(null);
    void assistant.ask({ convKey: current.key, threadId: current.threadId, question, onBusy: onBusy(current.key, question) });
    // 보낸 질문이 판 맨 위에 오게 — 진행 상황과 보고서가 그 아래로 자란다.
    requestAnimationFrame(() => scrollToLastTurn(scrollBehavior()));
  };

  const retry = (turn: Turn) => {
    if (!canAskHere) return;
    setBusyNotice(null);
    void assistant.ask({ convKey: current.key, threadId: current.threadId, question: turn.question, redoOf: turn.messageId, onBusy: onBusy(current.key, turn.question) });
    requestAnimationFrame(() => scrollToLastTurn(scrollBehavior()));
  };
  const startNew = () => {
    setShowAdvice(false);
    assistant.newConversation();
    setConfirmDelete(null);
    setRenaming(null);
    closeListOnPhone();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const remove = async (threadId: string) => {
    // 그사이 답을 만들기 시작한 대화는 지우지 않는다(서버도 거절한다 — 멈출 화면이 없는 질문이 자리를 차지하지 않게).
    if (running.has(threadId)) return;
    setDeleting(true);
    const error = await assistant.deleteThread(threadId);
    setDeleting(false);
    setDeleteError(error);
    if (!error) {
      setDeletedThreads((s) => new Set(s).add(threadId));
      setConfirmDelete(null);
      if (renaming === threadId) setRenaming(null);
      // 지운 행이 사라지며 초점이 body로 빠지지 않게 '새 질문'으로.
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-assistant-new]")?.focus());
    }
  };

  /** 목록을 접으면 열어 둔 지우기 확인도 닫는다 — 보이지 않는 확인이 첫 Esc를 먹지 않게. */
  const setListOpen = (v: boolean) => {
    if (!v) setConfirmDelete(null);
    onListOpenChange(v);
  };

  // 화면 낭독기용 알림 줄 — 방금 끝난 답의 결과를 읽는다(지난 대화의 실패를 한꺼번에 읽지 않게 차례 상자엔 역할을 달지 않았다).
  const last = current.turns[current.turns.length - 1];
  const announce =
    !last || last.status === "streaming" || last.status === "running"
      ? ""
      : last.status === "done"
        ? `보고서가 도착했습니다. ${last.report?.title ?? ""}`
        : last.status === "error"
          ? `답을 받지 못했습니다. ${last.error ?? ""}`
          : last.status === "stopped"
            ? "답을 멈췄습니다."
            : "";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key") {
          // Esc는 안쪽부터 — 이름 고치기 → 지우기 확인(목록 행) → 폰 서랍 → 판.
          // 지금 보는 대화의 이름을 고치는 중일 때만 — 다른 대화로 옮긴 뒤 남은 표시가 Esc를 삼키지 않게(리뷰 2026-11-06).
          if (renaming && renaming === current.threadId) {
            details.cancel();
            if (renameSavingFor.current !== renaming) setRenaming(null);
            return;
          }
          if (confirmDeleteLive) {
            details.cancel();
            // 지우는 중엔 닫지 않는다 — 실패하면 그 이유가 확인 안에 보인다.
            if (!deleting) setConfirmDelete(null);
            return;
          }
          if (listOpen && isPhone()) {
            details.cancel();
            setListOpen(false);
            return;
          }
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal keepMounted={keepMounted}>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/25 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          // 셸 크롬 층 — 이용 분석이 판 안의 입력을 바탕 화면의 활동으로 세지 않게(검색 팰릿과 같은 표식).
          data-usage-chrome=""
          // '지난 의견'을 보이는 중이면 입력칸이 감춰져 있다 — 첫 초점은 판의 기본 자리로.
          initialFocus={(type) => (type === "touch" ? false : showAdvice ? true : inputRef.current)}
          finalFocus={finalFocus}
          className={`bg-background text-foreground shadow-modal fixed inset-y-0 right-0 z-[80] flex w-full flex-col outline-none transition-[translate,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none ${expanded ? "" : "md:border-line md:w-[min(1120px,94vw)] md:border-l"}`}
        >
          {/* 폰 홈 화면 앱(노치)에서 머리가 상태 표시줄 밑에 숨지 않게 위쪽 안전 영역만큼 내린다. */}
          <header className="border-line flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b px-2.5 pt-[env(safe-area-inset-top)] sm:px-4">
            <Button
              type="button"
              variant="ghost"
              aria-expanded={listOpen}
              aria-controls={listId}
              onClick={() => setListOpen(!listOpen)}
            >
              <EyIcon name={listOpen ? "panelLeftClose" : "panelLeftOpen"} />
              목록
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="bg-gold-soft text-gold flex size-7 shrink-0 items-center justify-center rounded-lg">
                <EyIcon name="sparkle" size={16} />
              </span>
              <Dialog.Title className="text-foreground truncate text-lg font-bold">학원 비서</Dialog.Title>
            </div>
            <Dialog.Description className="sr-only">학원 자료를 물어보면 표와 차트로 정리한 보고서로 답합니다.</Dialog.Description>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {state.enabled === false ? null : (
                <Button type="button" variant="ghost" aria-pressed={showAdvice} onClick={() => setShowAdvice(!showAdvice)}>
                  <EyIcon name="listChecks" />
                  지난 의견
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                aria-pressed={expanded}
                onClick={() => onExpandedChange(!expanded)}
                className="hidden md:inline-flex"
              >
                <EyIcon name={expanded ? "copy" : "square"} />
                {expanded ? "원래 크기" : "크게 보기"}
              </Button>
              <Dialog.Close
                render={<Button type="button" variant="ghost" />}
                {...tipProps({ title: "닫기", lines: [`Esc 또는 ${hotkeyLabel}`, "닫아도 대화와 만들던 답은 그대로 남습니다."] })}
              >
                <EyIcon name="close" />
                닫기
              </Dialog.Close>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            {listOpen ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="목록 닫기"
                onClick={() => setListOpen(false)}
                className="absolute inset-0 z-10 bg-black/20 md:hidden"
              />
            ) : null}
            <aside
              id={listId}
              className={`${listOpen ? "flex" : "hidden"} border-line bg-background w-64 shrink-0 flex-col border-r max-md:shadow-modal max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-[min(20rem,85%)]`}
            >
              <AssistantThreadList
                threads={state.threads}
                load={state.threadsLoad}
                error={state.threadsError}
                currentThreadId={current.threadId}
                runningThreadIds={running}
                today={today}
                onSelect={(id) => {
                  setShowAdvice(false);
                  setConfirmDelete(null);
                  setRenaming(null);
                  assistant.selectThread(id);
                  closeListOnPhone();
                }}
                onNew={startNew}
                onRetry={() => void assistant.loadThreads()}
                // 확인을 열어 둔 사이 답을 만들기 시작한 대화는 확인을 거둔다(도는 대화는 지우지 않는다 · 적대 리뷰 2026-11-09).
                confirmDeleteId={confirmDeleteLive}
                deleting={deleting}
                deleteError={deleteError}
                onAskDelete={(id) => {
                  if (running.has(id)) return;
                  setDeleteError(null);
                  setConfirmDelete(id);
                }}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={(id) => void remove(id)}
              />
            </aside>

            {showAdvice ? (
              <section aria-label="지난 의견" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                <div className="mx-auto w-full max-w-[80rem] px-4 pt-5 pb-12 sm:px-6">
                  <AdviceList
                    active={open}
                    hiddenThreads={deletedThreads}
                    onOpenThread={(id) => {
                      // 누른 단추가 사라진다 — 대화를 먼저 보이게 확정하고 바로 입력칸에 초점(폰은 자판이 뜨지 않게 그대로 둔다).
                      // 다음 프레임으로 미루면 판(Base UI)이 사라진 초점을 판 루트로 되돌리는 것과 순서를 다툰다(재리뷰 2026-11-10).
                      flushSync(() => {
                        setShowAdvice(false);
                        setConfirmDelete(null);
                        setRenaming(null);
                      });
                      if (!isPhone()) inputRef.current?.focus();
                      assistant.selectThread(id);
                      closeListOnPhone();
                    }}
                  />
                </div>
              </section>
            ) : null}
            <section aria-label="대화" className={`${showAdvice ? "hidden" : "flex"} min-w-0 flex-1 flex-col`}>
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                <div className="mx-auto flex min-h-full w-full max-w-[80rem] flex-col px-4 pt-5 pb-12 sm:px-6">
                  <ConversationBody
                    conv={current}
                    enabled={state.enabled}
                    canAsk={canAskHere}
                    onSuggest={(q) => send(q, false)}
                    onRetry={retry}
                    onReload={() => current.threadId && void assistant.loadConversation(current.threadId, { quiet: current.turns.length > 0 })}
                    onControl={(turn, action) => (turn.messageId ? assistant.controlSaved(action, turn.messageId) : Promise.resolve(false))}
                    today={today}
                    renaming={!!current.threadId && renaming === current.threadId}
                    onAskRename={() => setRenaming(current.threadId)}
                    onCancelRename={() => setRenaming(null)}
                    onRenameSaving={(v) => {
                      const id = current.threadId;
                      if (v) renameSavingFor.current = id;
                      else if (renameSavingFor.current === id) renameSavingFor.current = null;
                    }}
                    onRename={async (title) => {
                      const id = current.threadId;
                      if (!id) return "대화를 찾지 못했습니다";
                      const error = await assistant.renameThread(id, title);
                      // 그사이 다른 대화의 이름을 고치기 시작했으면 그 편집 칸은 닫지 않는다(재리뷰 2026-11-09).
                      if (!error) setRenaming((cur) => (cur === id ? null : cur));
                      return error;
                    }}
                  />
                </div>
              </div>
              <div className="border-line bg-background shrink-0 border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
                <div className="mx-auto w-full max-w-[80rem]">
                  <AssistantComposer
                    value={draft}
                    onChange={onDraftChange}
                    onSend={() => send(draft, true)}
                    onStop={() => live && assistant.stop(live.key)}
                    onFinish={() => live && assistant.finish(live.key)}
                    streaming={streamingHere}
                    stopping={!!live && assistant.stopping.has(live.key)}
                    finishing={!!live && assistant.finishing.has(live.key)}
                    canFinish={canFinish}
                    blockedReason={blockedReason}
                    notice={busyNotice && busyNotice.key === current.key && state.threadsSeq === busyNotice.seq ? busyNotice.text : null}
                    inputRef={inputRef}
                  />
                </div>
              </div>
            </section>
          </div>
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConversationBody({
  conv,
  enabled,
  canAsk,
  onSuggest,
  onRetry,
  onReload,
  onControl,
  today,
  renaming,
  onAskRename,
  onCancelRename,
  onRenameSaving,
  onRename,
}: {
  conv: Conversation;
  enabled: boolean | null;
  canAsk: boolean;
  onSuggest: (q: string) => void;
  onRetry: (t: Turn) => void;
  onReload: () => void;
  /** 이 화면이 받지 않는(다른 탭 · 새로 고친 뒤) 도는 질문을 멈추거나 바로 결과 보기. */
  onControl: (turn: Turn, action: "stop" | "finish") => Promise<boolean>;
  /** 한국 날짜(판을 열 때 정한다) — 추천 질문이 날짜가 바뀌면 다시 받는다. */
  today: string;
  renaming: boolean;
  onAskRename: () => void;
  onCancelRename: () => void;
  onRenameSaving: (saving: boolean) => void;
  /** 실패하면 이유(한국어), 성공하면 null. */
  onRename: (title: string) => Promise<string | null>;
}) {
  // 이름 고치기를 마치면(저장·취소) 포커스를 '이름 바꾸기' 버튼으로 돌려준다 — 편집 칸이 사라지며 포커스가 body로 빠지지 않게(리뷰 2026-11-06).
  // 🔴 같은 대화일 때만 — 고치다가 목록에서 다른 대화를 고르면 그 대화의 버튼으로 초점이 튀지 않게(재리뷰 2026-11-09).
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const renamingFor = useRef<string | null>(null);
  useEffect(() => {
    if (renamingFor.current && !renaming && renamingFor.current === conv.threadId) renameButtonRef.current?.focus();
    renamingFor.current = renaming ? conv.threadId : null;
  }, [renaming, conv.threadId]);

  if (conv.turns.length === 0) {
    if (conv.threadId && (conv.load === "loading" || conv.load === "idle")) return <LoadingConversation />;
    if (conv.threadId && conv.load === "error") {
      return (
        <div className="my-auto flex flex-col items-center gap-3 py-12 text-center">
          <EyIcon name="alertCircle" size={28} className="text-danger" />
          <p className="text-base font-medium">{conv.loadError ?? "대화를 불러오지 못했습니다."}</p>
          <Button type="button" variant="outline" onClick={onReload}>
            <EyIcon name="sync" />
            다시 불러오기
          </Button>
        </div>
      );
    }
    return <EmptyState enabled={enabled} canAsk={canAsk} onSuggest={onSuggest} today={today} />;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {renaming && conv.threadId ? (
          <TitleEditor title={conv.title ?? ""} onCancel={onCancelRename} onSave={onRename} onSavingChange={onRenameSaving} />
        ) : (
          <h2 className="text-foreground min-w-0 flex-1 text-lg font-bold break-words">{conv.title ?? "새 대화"}</h2>
        )}
        {conv.threadId && !renaming ? (
          // 지우기는 목록 행의 x로 옮겼다(원장 2026-11-06 *"현재 대화 가장 위로 올라가야 지울 수 있는데"*).
          <Button ref={renameButtonRef} type="button" variant="ghost" onClick={onAskRename}>
            <EyIcon name="edit" />
            이름 바꾸기
          </Button>
        ) : null}
      </div>
      {conv.load === "error" && conv.loadError ? (
        <div className="bg-bg-soft/60 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">{`새로 고치지 못했습니다 — ${conv.loadError}`}</span>
          <Button type="button" variant="ghost" onClick={onReload}>
            <EyIcon name="sync" />
            다시 불러오기
          </Button>
        </div>
      ) : null}
      <ol className="space-y-10">
        {conv.turns.map((turn) => (
          <li key={turn.key} data-turn="" className="scroll-mt-4">
            <AssistantTurn
              turn={turn}
              canRetry={canAsk}
              onRetry={onRetry}
              // 강도를 올려 다시 묻기는 이 화면에서 방금 받은 마지막 답에만 권한다(지난 답·다시 연 대화엔 붙이지 않는다 · 원장 2026-11-12).
              onReload={onReload}
              onControl={onControl}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function LoadingConversation() {
  return (
    <div aria-busy="true" aria-label="대화를 불러오는 중" className="space-y-6">
      <div className="bg-bg-soft h-6 w-1/3 animate-pulse rounded motion-reduce:animate-none" />
      <div className="flex justify-end">
        <div className="bg-bg-soft h-11 w-2/5 animate-pulse rounded-2xl motion-reduce:animate-none" />
      </div>
      <div className="bg-bg-soft h-7 w-1/2 animate-pulse rounded motion-reduce:animate-none" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-bg-soft h-28 animate-pulse rounded-2xl motion-reduce:animate-none" />
        ))}
      </div>
      <div className="bg-bg-soft h-72 animate-pulse rounded-2xl motion-reduce:animate-none" />
    </div>
  );
}

/**
 * 처음 화면 — 인사 + 추천 질문(누르면 바로 묻는다). 비서를 쓸 수 없는 지점이면 그 사실만.
 * 추천 질문은 이 지점의 최근 추세로 고른 것(원장 2026-11-06 *"최근 학원 추세를 보고 스마트하게"*) — 하루 한 번 받고 '새로 고침'으로 다시 센다.
 * 직전 묶음에 없던 질문에는 NEW(원장 *"이전과 변경된 새로운 질문이 배치될때마다 NEW 라벨"*).
 */
function EmptyState({ enabled, canAsk, onSuggest, today }: { enabled: boolean | null; canAsk: boolean; onSuggest: (q: string) => void; today: string }) {
  const suggestions = useAssistantSuggestions(enabled !== false, today);
  return (
    <div className="@container my-auto flex flex-col items-center py-10 text-center">
      <span aria-hidden className="bg-gold-soft text-gold flex size-14 items-center justify-center rounded-2xl">
        <EyIcon name="sparkle" size={28} />
      </span>
      {enabled === false ? (
        <>
          <h2 className="mt-5 text-2xl font-bold">학원 비서를 쓸 수 없습니다</h2>
          <p className="mt-2 max-w-md text-base">이 지점에서는 아직 학원 비서가 켜지지 않았습니다.</p>
        </>
      ) : (
        <>
          <h2 className="mt-5 text-2xl font-bold">무엇이 궁금하세요?</h2>
          <p className="mt-2 max-w-md text-base">학원 자료를 직접 찾아 숫자·표·차트로 정리해 드립니다.</p>
          <div className="mt-8 w-full max-w-3xl">
            <div className="flex items-center justify-between gap-3 px-1 pb-2 text-left">
              <span className="text-xs font-medium">
                {suggestions.day ? `${monthDayLabel(suggestions.day)} 학원 자료로 고른 질문` : "추천 질문"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={suggestions.refresh}
                disabled={!suggestions.canRefresh}
                aria-busy={suggestions.refreshing || undefined}
                {...tipProps({ title: "추천 질문 새로 고침", lines: ["지금 학원 자료로 다시 셉니다(하루 한 번은 저절로)."] })}
              >
                <EyIcon name="sync" size={14} className={suggestions.refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
                {suggestions.refreshing ? "세는 중" : "새로 고침"}
              </Button>
            </div>
            {suggestions.status === "loading" ? (
              <ul aria-busy="true" aria-label="추천 질문을 고르는 중" className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <li key={i} className="bg-bg-soft h-14 animate-pulse rounded-xl motion-reduce:animate-none" />
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-1 gap-2.5 text-left @2xl:grid-cols-2">
                {suggestions.items.map((item) => {
                  const isNew = suggestions.fresh.has(item.text);
                  return (
                    <li key={item.text}>
                      <button
                        type="button"
                        disabled={!canAsk}
                        onClick={() => onSuggest(item.text)}
                        className="border-line hover:bg-muted hover:border-line-strong focus-visible:outline-primary flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                      >
                        <EyIcon name="sparkle" size={16} className="text-gold shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words">{item.text}</span>
                          {item.reason ? <span className="num mt-0.5 block text-xs font-normal">{item.reason}</span> : null}
                        </span>
                        {isNew ? (
                          <span className="bg-primary text-primary-foreground shrink-0 rounded-md px-1.5 py-0.5 text-xs leading-none font-bold tracking-wide">
                            NEW
                          </span>
                        ) : null}
                        <EyIcon name="arrowRight" size={16} className="shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 대화 이름 고치기 — 제목 자리가 입력칸이 된다(Enter 저장 · Esc 취소 · 80자). 열 때마다 새로 그려 지금 이름에서 시작한다.
 * 서버가 공백을 정리한 이름을 돌려주면 그 이름이 목록·머리에 들어간다(use-assistant renameThread).
 */
function TitleEditor({
  title,
  onCancel,
  onSave,
  onSavingChange,
}: {
  title: string;
  onCancel: () => void;
  onSave: (title: string) => Promise<string | null>;
  onSavingChange: (saving: boolean) => void;
}) {
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const save = async () => {
    if (saving) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) return setError("이름을 적어 주세요");
    if (next === title) return onCancel();
    setSaving(true);
    onSavingChange(true);
    const failed = await onSave(next);
    onSavingChange(false);
    setSaving(false);
    if (failed) setError(failed);
  };
  return (
    <form
      className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        대화 이름
      </label>
      <Input
        id={inputId}
        autoFocus
        value={draft}
        maxLength={80}
        // 저장 중엔 막지 않고 읽기 전용 — 막으면 포커스가 빠져 그사이 Esc가 판의 Esc 사슬로 가 편집 칸을 닫고 실패 이유가 사라진다(리뷰 2026-11-06).
        readOnly={saving}
        aria-busy={saving || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // 한글 조합 중의 Esc는 조합만 끝낸다 · 저장 중엔 닫지 않는다(결과·실패 이유를 기다린다).
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          if (!saving) onCancel();
        }}
        className="h-9 min-w-[12rem] flex-1 text-base font-bold md:text-base"
      />
      {/* 저장 중에도 disabled로 두지 않는다 — 누른 버튼이 막히면 포커스가 body로 빠져 그사이 Esc가 판의 Esc 사슬로 가 편집 칸을 닫고 실패 이유가 사라진다(재리뷰 2026-11-09). 두 번 눌림은 save가 거른다. */}
      <Button type="submit" aria-disabled={saving || undefined} className={saving ? "opacity-50" : undefined}>
        <EyIcon name="check" />
        {saving ? "저장 중" : "저장"}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
        취소
      </Button>
      {error ? <p className="text-danger w-full text-sm font-medium">{error}</p> : null}
    </form>
  );
}
