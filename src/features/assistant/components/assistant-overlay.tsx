"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssistantLevel } from "@/features/assistant/levels";
import { ASSISTANT_SUGGESTIONS } from "@/features/assistant/protocol";
import { isConversationStreaming, type Conversation, type Turn } from "./assistant-state";
import { AssistantComposer } from "./assistant-composer";
import { AssistantThreadList } from "./assistant-thread-list";
import { AssistantTurn } from "./assistant-turn";
import type { useAssistant } from "./use-assistant";

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
 * 🔑 z-[80] — 셸 머리(z-60)·공지 팝업(z-55)·드롭다운(z-60) 위, 카드 툴팁 레이어(z-9999) 아래(그래서 강도 설명 카드가 판 위에 뜬다).
 *    🔴 그래서 판 안에는 **포털로 뜨는 공용 팝업**(ui/tooltip z-50 · dropdown-menu·select z-60)을 쓰지 않는다 — 판 뒤에 깔린다.
 * 🔑 판은 최상위 문서에만 있다(창 = iframe 위에 덮인다). 상태는 런처가 든다 — 닫아도 대화·받던 답이 그대로다.
 */
export function AssistantOverlay({
  open,
  onOpenChange,
  keepMounted,
  finalFocus,
  assistant,
  level,
  onLevelChange,
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
  level: AssistantLevel;
  onLevelChange: (l: AssistantLevel) => void;
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 이름을 고치는 중인 대화(원장 2026-11-06 *"대화 이름 변경도 가능하게"*) — Esc는 이것부터 닫는다. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 이름을 저장하는 중인 대화 — 그 대화의 편집 칸은 Esc로 닫지 않는다(결과·실패 이유를 기다린다 · 재리뷰 2026-11-09). 다른 대화의 편집 칸은 막지 않는다. */
  const renameSavingFor = useRef<string | null>(null);

  const streamingHere = isConversationStreaming(state, current);
  const streamingThreadId = state.inflight
    ? (Object.values(state.conversations).find((c) => c.turns.some((t) => t.key === state.inflight!.turnKey))?.threadId ?? null)
    : null;
  const blockedReason =
    state.enabled === false
      ? "이 지점에서는 학원 비서를 쓸 수 없습니다."
      : state.inflight && !streamingHere
        ? "다른 대화에서 답을 만드는 중입니다. 끝나면 보낼 수 있습니다."
        : null;

  const scrollToLastTurn = (behavior: ScrollBehavior) => scrollLastTurnIntoView(scrollRef.current, behavior);

  // 다른 대화를 열었거나 저장본이 도착하면 마지막 질문을 맨 위에(긴 보고서의 끝이 아니라 시작이 보이게).
  const readyKey = current.load === "ready" ? current.key : null;
  useEffect(() => {
    if (readyKey) scrollLastTurnIntoView(scrollRef.current, "auto");
  }, [readyKey]);

  const closeListOnPhone = () => {
    if (isPhone()) onListOpenChange(false);
  };

  const send = (text: string, fromDraft: boolean) => {
    const question = text.trim();
    if (!question || blockedReason || state.inflight) return;
    if (fromDraft) onDraftChange("");
    void assistant.ask({ convKey: current.key, threadId: current.threadId, question, level });
    // 보낸 질문이 판 맨 위에 오게 — 진행 상황과 보고서가 그 아래로 자란다.
    requestAnimationFrame(() => scrollToLastTurn(scrollBehavior()));
  };

  const retry = (turn: Turn) => {
    if (state.inflight) return;
    void assistant.ask({ convKey: current.key, threadId: current.threadId, question: turn.question, level: turn.level });
    requestAnimationFrame(() => scrollToLastTurn(scrollBehavior()));
  };

  const startNew = () => {
    assistant.newConversation();
    setConfirmDelete(null);
    setRenaming(null);
    closeListOnPhone();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const remove = async (threadId: string) => {
    setDeleting(true);
    const error = await assistant.deleteThread(threadId);
    setDeleting(false);
    setDeleteError(error);
    if (!error) {
      setConfirmDelete(null);
      setRenaming(null);
    }
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
          // Esc는 안쪽부터 — 이름 고치기 → 지우기 확인 → 폰 서랍 → 판.
          // 지금 보는 대화의 이름을 고치는 중일 때만 — 다른 대화로 옮긴 뒤 남은 표시가 Esc를 삼키지 않게(리뷰 2026-11-06).
          if (renaming && renaming === current.threadId) {
            details.cancel();
            if (renameSavingFor.current !== renaming) setRenaming(null);
            return;
          }
          if (confirmDelete) {
            details.cancel();
            setConfirmDelete(null);
            return;
          }
          if (listOpen && isPhone()) {
            details.cancel();
            onListOpenChange(false);
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
          initialFocus={(type) => (type === "touch" ? false : inputRef.current)}
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
              onClick={() => onListOpenChange(!listOpen)}
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
                onClick={() => onListOpenChange(false)}
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
                streamingThreadId={streamingThreadId}
                today={today}
                onSelect={(id) => {
                  setConfirmDelete(null);
                  setRenaming(null);
                  assistant.selectThread(id);
                  closeListOnPhone();
                }}
                onNew={startNew}
                onRetry={() => void assistant.loadThreads()}
              />
            </aside>

            <section aria-label="대화" className="flex min-w-0 flex-1 flex-col">
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                <div className="mx-auto flex min-h-full w-full max-w-[80rem] flex-col px-4 pt-5 pb-12 sm:px-6">
                  <ConversationBody
                    conv={current}
                    enabled={state.enabled}
                    canAsk={!blockedReason && !state.inflight}
                    onSuggest={(q) => send(q, false)}
                    onRetry={retry}
                    onReload={() => current.threadId && void assistant.loadConversation(current.threadId, { quiet: current.turns.length > 0 })}
                    streamingHere={streamingHere}
                    confirmDelete={confirmDelete === current.threadId}
                    onAskDelete={() => {
                      setDeleteError(null);
                      setConfirmDelete(current.threadId);
                    }}
                    onCancelDelete={() => setConfirmDelete(null)}
                    onDelete={() => current.threadId && void remove(current.threadId)}
                    deleting={deleting}
                    deleteError={deleteError}
                    renaming={!!current.threadId && renaming === current.threadId}
                    onAskRename={() => {
                      setConfirmDelete(null);
                      setRenaming(current.threadId);
                    }}
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
                    level={level}
                    onLevelChange={onLevelChange}
                    onSend={() => send(draft, true)}
                    onStop={assistant.stop}
                    streaming={streamingHere}
                    stopping={assistant.stopping}
                    blockedReason={blockedReason}
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
  streamingHere,
  confirmDelete,
  onAskDelete,
  onCancelDelete,
  onDelete,
  deleting,
  deleteError,
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
  streamingHere: boolean;
  confirmDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
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
    return <EmptyState enabled={enabled} canAsk={canAsk} onSuggest={onSuggest} />;
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
          confirmDelete ? (
            <div role="group" aria-label="대화 지우기 확인" className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">이 대화를 지울까요? 되돌릴 수 없습니다.</span>
              <Button type="button" variant="destructive" onClick={onDelete} disabled={deleting}>
                <EyIcon name="trash" />
                {deleting ? "지우는 중" : "지우기"}
              </Button>
              <Button type="button" variant="ghost" onClick={onCancelDelete} disabled={deleting}>
                취소
              </Button>
            </div>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              <Button ref={renameButtonRef} type="button" variant="ghost" onClick={onAskRename}>
                <EyIcon name="edit" />
                이름 바꾸기
              </Button>
              <Button type="button" variant="ghost" onClick={onAskDelete} disabled={streamingHere}>
                <EyIcon name="trash" />
                대화 지우기
              </Button>
            </span>
          )
        ) : null}
      </div>
      {deleteError && confirmDelete ? <p className="text-danger text-sm font-medium">{deleteError}</p> : null}
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
            <AssistantTurn turn={turn} canRetry={canAsk} onRetry={onRetry} onReload={onReload} />
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

/** 처음 화면 — 인사 + 추천 질문(누르면 바로 묻는다). 비서를 쓸 수 없는 지점이면 그 사실만. */
function EmptyState({ enabled, canAsk, onSuggest }: { enabled: boolean | null; canAsk: boolean; onSuggest: (q: string) => void }) {
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
          <ul className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-2.5 text-left @2xl:grid-cols-2">
            {ASSISTANT_SUGGESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={!canAsk}
                  onClick={() => onSuggest(q)}
                  className="border-line hover:bg-muted hover:border-line-strong focus-visible:outline-primary flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  <EyIcon name="sparkle" size={16} className="text-gold shrink-0" />
                  <span className="min-w-0 flex-1 break-words">{q}</span>
                  <EyIcon name="arrowRight" size={16} className="shrink-0" />
                </button>
              </li>
            ))}
          </ul>
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
