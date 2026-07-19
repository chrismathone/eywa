"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { askAssistant } from "@/features/assistant/server/actions";
import type { StoredTurn } from "@/features/assistant/turns";

/** 빈 대화 상태의 제안 질문 칩 — 클릭하면 입력칸에 채워 바로 다듬어 보낼 수 있게. */
const EXAMPLE_QUESTIONS = [
  "이번 달 수납률은?",
  "그만둘 것 같은 학생 알려줘",
  "오늘 결석한 학생 있어?",
  "이번 주 상담 예정 알려줘",
];

/**
 * 운영실 AI 비서 질문 패널 — "학원 매니저 팀" Phase 2(대화 채널).
 * 질문 1건 = 서버 액션 1회(명시적 트리거). 노출은 page.tsx의 canManageStaff 게이트 뒤.
 * 아바타/이니셜 배지 금지 규칙 — 역할은 텍스트 라벨로만 구분한다.
 */
export function AssistantPanel({
  initialConversationId,
  initialTurns,
}: {
  initialConversationId: string | null;
  initialTurns: StoredTurn[];
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [turns, setTurns] = useState<StoredTurn[]>(initialTurns);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 새 턴·생각 중 표시가 항상 보이게 아래로 — DOM 스크롤만(상태 변경 없음, #25 무관).
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pending]);

  const submit = () => {
    const question = input.trim();
    if (!question || pending) return;
    setError(null);
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: question, at: "" }]);
    startTransition(async () => {
      const result = await askAssistant(conversationId, question);
      if (!result.ok) {
        // 실패한 질문은 낙관 버블 제거 + 입력 복원 — DB에 없는 유령 버블이 다음 성공 응답의
        // setTurns(서버 턴 교체)에서 조용히 증발하던 문제와 재시도 재타이핑 유실 방지(적대 리뷰 확정).
        setTurns((prev) => prev.slice(0, -1));
        setInput((current) => (current.trim() ? current : question));
        setError(result.error);
        return;
      }
      if (result.conversationId) setConversationId(result.conversationId);
      setTurns(result.turns);
    });
  };

  return (
    <section
      className="bg-card border-line/60 shadow-card overflow-hidden rounded-2xl border"
      aria-labelledby="assistant-panel-title"
    >
      <header className="border-line/70 flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-2xl"
            aria-hidden="true"
          >
            <EyIcon name="message" size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-primary text-[12px] font-semibold">
              대화형 비서
            </p>
            <h2 id="assistant-panel-title" className="text-foreground mt-0.5 text-[16px] font-extrabold tracking-tight">
              매니저 팀에게 물어보기
            </h2>
          </div>
        </div>
        {turns.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setConversationId(null);
              setTurns([]);
              setError(null);
            }}
          >
            새 대화
          </Button>
        ) : null}
      </header>

      {turns.length > 0 || pending ? (
        <div ref={scrollRef} className="max-h-96 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
          {turns.map((turn, index) => (
            <div key={index} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  turn.role === "user"
                    ? "bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                    : "bg-bg-soft text-foreground max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                }
              >
                {turn.content}
              </div>
            </div>
          ))}
          {pending ? (
            <div className="flex justify-start">
              <div className="bg-bg-soft text-text-dim max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-[13.5px]">
                조회하고 있습니다…
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-5 py-4 sm:px-6">
          <p className="text-text-dim text-[13.5px]">학원 데이터를 조회해 바로 답해드려요.</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setInput(q)}
                className="border-line bg-card text-text-dim hover:border-primary/35 hover:text-foreground rounded-pill border px-3 py-1.5 text-[12.5px] transition"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-line/70 border-t px-5 py-4 sm:px-6">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={500}
            placeholder="무엇이든 물어보세요"
            className="border-line bg-card text-foreground placeholder:text-text-faint focus-visible:ring-primary/40 min-h-11 flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-[14px] leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
          />
          <Button type="button" disabled={pending || input.trim().length === 0} onClick={submit}>
            {pending ? "조회 중…" : "질문"}
          </Button>
        </div>
        {error ? <p className="text-danger mt-1.5 text-[12px]">{error}</p> : null}
      </div>
    </section>
  );
}
