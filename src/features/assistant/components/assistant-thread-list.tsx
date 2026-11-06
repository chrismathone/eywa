"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import type { ThreadSummary } from "@/features/assistant/protocol";
import { groupThreadsByDay } from "./assistant-state";

/**
 * 지난 대화 — '새 질문' + 날짜 묶음(오늘·어제·지난 7일·이전) 목록. 행 전체가 버튼이다(지우기는 대화 머리에서 — 목록 행 안 아이콘 버튼 금지).
 * 답을 받는 중인 대화는 옆에 도는 표시.
 */
export function AssistantThreadList({
  threads,
  load,
  error,
  currentThreadId,
  streamingThreadId,
  today,
  onSelect,
  onNew,
  onRetry,
}: {
  threads: readonly ThreadSummary[];
  load: "idle" | "loading" | "ready" | "error";
  error: string | null;
  currentThreadId: string | null;
  streamingThreadId: string | null;
  /** KST 오늘(YYYY-MM-DD) — 열 때 정한다. */
  today: string;
  onSelect: (threadId: string) => void;
  onNew: () => void;
  onRetry: () => void;
}) {
  const groups = today ? groupThreadsByDay(threads, today) : [];
  return (
    <nav aria-label="지난 대화" className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 pb-2">
        <Button type="button" variant="outline" onClick={onNew} className="w-full justify-start">
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
              {g.items.map(({ thread, when }) => {
                const on = thread.id === currentThreadId;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(thread.id)}
                      aria-current={on ? "true" : undefined}
                      className={`flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors motion-reduce:transition-none ${on ? "bg-primary-soft text-primary font-bold" : "hover:bg-muted font-medium"}`}
                    >
                      <span className="min-w-0 flex-1 truncate" title={thread.title}>
                        {thread.title}
                      </span>
                      {thread.id === streamingThreadId ? (
                        <EyIcon name="loader" size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-label="답을 만드는 중" />
                      ) : (
                        <span className="num shrink-0 text-xs font-medium">{when}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {error && threads.length > 0 ? <p className="px-2 pt-3 text-xs">{error}</p> : null}
      </div>
    </nav>
  );
}
