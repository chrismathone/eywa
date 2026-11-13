"use client";

import {
  useId,
  useLayoutEffect,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ASSISTANT_QUESTION_MAX } from "@/features/assistant/protocol";

/** 입력창이 자라는 최대 높이(px) — 그 위로는 안에서 스크롤한다. */
const MAX_INPUT_H = 200;

/**
 * 질문 입력 — Enter 보내기 · Shift+Enter 줄바꿈(한글 조합 중 Enter는 글자 확정이라 보내지 않는다) · 최대 길이 ·
 * 답을 받는 중엔 '바로 결과 보기'와 '멈추기'.
 * '바로 결과 보기'(원장 2026-11-06 *"'여기서 조회 끝내고 바로 결과 출력' 버튼 만들자"*) — 더 조회하지 않고 지금까지 조회한 내용으로 보고서를 쓴다.
 * 조회를 하나도 마치지 않았으면 보여 줄 근거가 없어 막는다.
 */
export function AssistantComposer({
  value,
  onChange,
  onSend,
  onStop,
  onFinish,
  streaming,
  stopping = false,
  finishing = false,
  canFinish = false,
  blockedReason,
  notice = null,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** '바로 결과 보기' — 더 조회하지 않고 지금까지의 결과로 보고서를 쓰게 한다. */
  onFinish?: () => void;
  /** 이 대화에서 답을 받는 중. */
  streaming: boolean;
  /** '멈추기'를 눌렀고 서버가 멈추기를 기다리는 중. */
  stopping?: boolean;
  /** '바로 결과 보기'를 눌렀고 보고서를 기다리는 중. */
  finishing?: boolean;
  /** 조회를 하나라도 마쳤다(보고서에 쓸 근거가 있다). */
  canFinish?: boolean;
  /** 보낼 수 없는 까닭(이 대화가 아직 도는 중 · 동시 자리 3개가 참 · 비서를 쓸 수 없는 지점). 있으면 보내기를 막고 이 글을 보인다. */
  blockedReason: string | null;
  /** 막지는 않는 안내(서버가 자리가 없어 받지 않았다 — 보낸 글은 입력칸에 되돌려 놓았다). */
  notice?: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const canSend = value.trim().length > 0 && !streaming && !blockedReason;
  const finishHintId = useId();
  const near = value.length >= ASSISTANT_QUESTION_MAX * 0.8;

  // 글이 늘면 입력창도 자란다(최대 MAX_INPUT_H) — 보낸 뒤 비우면 한 줄로 돌아온다.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`;
  }, [value, inputRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // 한글 조합 중 Enter = 글자 확정(IME). 여기서 보내면 마지막 글자가 두 번 들어가거나 덜 친 질문이 나간다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="@container">
      <div className="border-line bg-card focus-within:border-primary/50 focus-within:ring-primary/10 rounded-2xl border transition-[border-color,box-shadow] focus-within:ring-3 motion-reduce:transition-none">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={ASSISTANT_QUESTION_MAX}
          rows={1}
          aria-label="질문"
          placeholder="궁금한 것을 물어보세요 · Shift+Enter로 줄바꿈"
          className="text-foreground block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-relaxed outline-none"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3">
          <span className="ml-auto flex items-center gap-2.5">
            {near ? (
              <span
                className={`num text-xs whitespace-nowrap ${value.length >= ASSISTANT_QUESTION_MAX ? "text-danger font-bold" : ""}`}
              >
                {`${value.length.toLocaleString("ko-KR")}/${ASSISTANT_QUESTION_MAX.toLocaleString("ko-KR")}`}
              </span>
            ) : null}
            {streaming ? (
              <>
                {onFinish ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onFinish}
                      disabled={finishing || stopping || !canFinish}
                      aria-describedby={finishHintId}
                      {...tipProps({
                        title: "여기서 조회 끝내고 바로 결과 보기",
                        lines: [
                          canFinish || finishing
                            ? "더 조회하지 않고, 지금까지 조회한 내용으로만 보고서를 씁니다."
                            : "조회를 하나 마친 뒤 누를 수 있습니다.",
                        ],
                      })}
                    >
                      <EyIcon name="report" />
                      {finishing ? "결과 정리 중…" : "바로 결과 보기"}
                    </Button>
                    <span id={finishHintId} hidden>
                      {canFinish || finishing
                        ? "더 조회하지 않고, 지금까지 조회한 내용으로만 보고서를 씁니다."
                        : "조회를 하나 마친 뒤 누를 수 있습니다."}
                    </span>
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={onStop}
                  disabled={stopping}
                >
                  <EyIcon name="stop" />
                  {stopping ? "멈추는 중…" : "멈추기"}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={onSend} disabled={!canSend}>
                <EyIcon name="send" />
                보내기
              </Button>
            )}
          </span>
        </div>
      </div>
      {/* 늘 있는 알림 칸 — 조건부로 생기는 status는 첫 안내를 낭독하지 못한다(적대 리뷰 2026-11-09). */}
      <div
        aria-live="polite"
        className={blockedReason || notice ? "mt-2 px-1 text-sm" : "sr-only"}
      >
        {blockedReason || notice ? (
          <p className="flex items-start gap-1.5">
            <EyIcon name="clock" size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              {blockedReason ?? notice}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
