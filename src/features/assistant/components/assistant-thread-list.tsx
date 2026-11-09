"use client";

import { useEffect, useRef } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import type { ThreadSummary } from "@/features/assistant/protocol";
import { groupThreadsByDay } from "./assistant-state";

/**
 * 지난 대화 — '새 질문' + 날짜 묶음(오늘·어제·지난 7일·이전) 목록. 행 전체가 대화를 여는 버튼이다.
 * 🔴 지우기 = 행에 마우스를 올리면(키보드 초점 · 터치 화면은 늘) 나오는 x — 원장 2026-11-06 *"대화 지우기도 현재 대화 가장 위로 올라가야
 *    지울 수 있는데, 대화 목록에서 x 버튼 마우스 오버시에 나오도록"*. 목록 행 안 아이콘 버튼을 두지 않는 앱 규약(design-conventions)의
 *    원장 지시 예외다. x는 여는 버튼 **옆**(겹친 형제)이라 버튼 안에 버튼이 들어가지 않는다. 누르면 그 행이 '지울까요?' 확인으로 바뀐다.
 * 답을 만드는 중인 대화는 옆에 도는 표시(x 없음 — 도는 동안은 지우지 않는다). 다른 탭·기기에서 도는 대화도 같다(목록 `running`).
 */
export function AssistantThreadList({
  threads,
  load,
  error,
  currentThreadId,
  runningThreadIds,
  today,
  onSelect,
  onNew,
  onRetry,
  confirmDeleteId,
  deleting,
  deleteError,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  threads: readonly ThreadSummary[];
  load: "idle" | "loading" | "ready" | "error";
  error: string | null;
  currentThreadId: string | null;
  runningThreadIds: ReadonlySet<string>;
  /** KST 오늘(YYYY-MM-DD) — 열 때 정한다. */
  today: string;
  onSelect: (threadId: string) => void;
  onNew: () => void;
  onRetry: () => void;
  /** 지울지 묻는 중인 대화. */
  confirmDeleteId: string | null;
  deleting: boolean;
  deleteError: string | null;
  onAskDelete: (threadId: string) => void;
  onCancelDelete: () => void;
  onDelete: (threadId: string) => void;
}) {
  const groups = today ? groupThreadsByDay(threads, today) : [];
  return (
    <nav aria-label="지난 대화" className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 pb-2">
        <Button type="button" variant="outline" onClick={onNew} className="w-full justify-start" data-assistant-new="">
          <EyIcon name="plus" />
          새 질문
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
        {load === "loading" && threads.length === 0 ? (
          <ul aria-hidden className="space-y-1.5 px-1 pt-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="bg-bg-soft h-9 animate-pulse rounded-lg" />
            ))}
          </ul>
        ) : null}
        {load === "error" && threads.length === 0 ? (
          <div className="space-y-2 px-2 pt-3 text-sm">
            <p>{error ?? "지난 대화를 불러오지 못했습니다."}</p>
            <Button type="button" variant="ghost" onClick={onRetry}>
              <EyIcon name="sync" />
              다시 불러오기
            </Button>
          </div>
        ) : null}
        {load === "ready" && threads.length === 0 ? <p className="px-2 pt-3 text-sm">아직 물어본 대화가 없습니다.</p> : null}
        {groups.map((g) => (
          <section key={g.label} className="pt-3">
            <h3 className="px-2 pb-1 text-xs font-bold">{g.label}</h3>
            <ul className="space-y-0.5">
              {g.items.map(({ thread, when }) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  when={when}
                  on={thread.id === currentThreadId}
                  running={runningThreadIds.has(thread.id)}
                  confirming={thread.id === confirmDeleteId}
                  deleting={deleting}
                  deleteError={deleteError}
                  onSelect={onSelect}
                  onAskDelete={onAskDelete}
                  onCancelDelete={onCancelDelete}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </section>
        ))}
        {error && threads.length > 0 ? <p className="px-2 pt-3 text-xs">{error}</p> : null}
      </div>
    </nav>
  );
}

function ThreadRow({
  thread,
  when,
  on,
  running,
  confirming,
  deleting,
  deleteError,
  onSelect,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  thread: ThreadSummary;
  when: string;
  on: boolean;
  running: boolean;
  confirming: boolean;
  deleting: boolean;
  deleteError: string | null;
  onSelect: (threadId: string) => void;
  onAskDelete: (threadId: string) => void;
  onCancelDelete: () => void;
  onDelete: (threadId: string) => void;
}) {
  // 초점 — 확인이 열리면 '취소'(Enter 한 번에 지워지지 않게), 닫히면(취소·Esc) 다시 그 행의 x로(초점이 body로 빠지지 않게).
  const cancelRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) removeRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (confirming) {
    return (
      <li>
        <div role="group" aria-label={`'${thread.title}' 대화 지우기 확인`} className="bg-danger-soft rounded-lg px-2.5 py-2 text-sm">
          <p className="font-medium break-words">
            <span className="font-bold">{thread.title}</span> 대화를 지울까요? 되돌릴 수 없습니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(thread.id)} disabled={deleting}>
              <EyIcon name="trash" />
              {deleting ? "지우는 중" : "지우기"}
            </Button>
            <Button ref={cancelRef} type="button" size="sm" variant="ghost" onClick={onCancelDelete} disabled={deleting}>
              취소
            </Button>
          </div>
          {deleteError ? <p className="text-danger mt-1.5 text-xs font-medium">{deleteError}</p> : null}
        </div>
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => onSelect(thread.id)}
        aria-current={on ? "true" : undefined}
        className={`flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-9 pl-2.5 text-left text-sm transition-colors motion-reduce:transition-none ${on ? "bg-primary-soft text-primary font-bold" : "hover:bg-muted font-medium"}`}
      >
        <span className="min-w-0 flex-1 truncate" title={thread.title}>
          {thread.title}
        </span>
        {running ? (
          <EyIcon name="loader" size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-label="답을 만드는 중" />
        ) : (
          // x가 나오는 동안(마우스·초점·터치)은 날짜를 감춘다 — 같은 자리라 겹치지 않게.
          <span className="num shrink-0 text-xs font-medium group-focus-within/row:invisible group-hover/row:invisible [@media(hover:none)]:invisible">{when}</span>
        )}
      </button>
      {running ? null : (
        <button
          ref={removeRef}
          type="button"
          aria-label={`'${thread.title}' 대화 지우기`}
          onClick={() => onAskDelete(thread.id)}
          {...tipProps({ title: "대화 지우기", lines: ["지우기 전에 한 번 더 묻습니다."] })}
          className="hover:text-danger hover:bg-danger-soft focus-visible:outline-primary absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        >
          <EyIcon name="close" size={14} />
        </button>
      )}
    </li>
  );
}
