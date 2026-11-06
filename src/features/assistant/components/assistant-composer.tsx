"use client";

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { ASSISTANT_LEVEL_HINT, ASSISTANT_LEVEL_LABEL, ASSISTANT_LEVELS, type AssistantLevel } from "@/features/assistant/levels";
import { ASSISTANT_QUESTION_MAX } from "@/features/assistant/protocol";

/** 입력창이 자라는 최대 높이(px) — 그 위로는 안에서 스크롤한다. */
const MAX_INPUT_H = 200;

/**
 * 질문 입력 — Enter 보내기 · Shift+Enter 줄바꿈(한글 조합 중 Enter는 글자 확정이라 보내지 않는다) · 최대 길이 ·
 * 추론 강도(적음/보통/강함 — 모델 이름은 보이지 않는다) · 답을 받는 중엔 '멈추기'.
 */
export function AssistantComposer({
  value,
  onChange,
  level,
  onLevelChange,
  onSend,
  onStop,
  streaming,
  stopping = false,
  blockedReason,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  level: AssistantLevel;
  onLevelChange: (l: AssistantLevel) => void;
  onSend: () => void;
  onStop: () => void;
  /** 이 대화에서 답을 받는 중. */
  streaming: boolean;
  /** '멈추기'를 눌렀고 서버가 멈추기를 기다리는 중. */
  stopping?: boolean;
  /** 보낼 수 없는 까닭(다른 대화가 답을 받는 중 · 비서를 쓸 수 없는 지점). 있으면 보내기를 막고 이 글을 보인다. */
  blockedReason: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const canSend = value.trim().length > 0 && !streaming && !blockedReason;
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
          <LevelPicker value={level} onChange={onLevelChange} />
          <span className="hidden min-w-0 truncate text-xs @2xl:inline">{ASSISTANT_LEVEL_HINT[level]}</span>
          <span className="ml-auto flex items-center gap-2.5">
            {near ? (
              <span className={`num text-xs whitespace-nowrap ${value.length >= ASSISTANT_QUESTION_MAX ? "text-danger font-bold" : ""}`}>
                {`${value.length.toLocaleString("ko-KR")}/${ASSISTANT_QUESTION_MAX.toLocaleString("ko-KR")}`}
              </span>
            ) : null}
            {streaming ? (
              <Button type="button" variant="outline" onClick={onStop} disabled={stopping}>
                <EyIcon name="stop" />
                {stopping ? "멈추는 중…" : "멈추기"}
              </Button>
            ) : (
              <Button type="button" onClick={onSend} disabled={!canSend}>
                <EyIcon name="send" />
                보내기
              </Button>
            )}
          </span>
        </div>
      </div>
      {blockedReason ? <p className="mt-2 px-1 text-sm">{blockedReason}</p> : null}
    </div>
  );
}

/**
 * 추론 강도 — 세그먼트 한 묶음(툴바 규약의 상자·칩 치수를 그대로 쓴다). 라디오 묶음이라 ←→로 옮긴다.
 * 설명은 마우스를 올리면 카드(`tipProps`)로, 낭독기는 `aria-describedby`로 읽는다(터치엔 hover가 없어 넓은 화면은 옆에 글로도 적는다).
 */
function LevelPicker({ value, onChange }: { value: AssistantLevel; onChange: (l: AssistantLevel) => void }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const n = ASSISTANT_LEVELS.length;
    const to = step === Infinity ? n - 1 : step === -Infinity ? 0 : (from + step + n) % n;
    onChange(ASSISTANT_LEVELS[to]!);
    refs.current[to]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (!step) return;
    e.preventDefault();
    move(i, step);
  };
  return (
    <div className="flex items-center gap-2">
      <span id={`${id}-label`} className="hidden text-sm font-medium whitespace-nowrap @md:inline">
        추론 강도
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className={TOOLBAR_SEG_BOX}>
        {ASSISTANT_LEVELS.map((lv, i) => {
          const on = lv === value;
          return (
            <button
              key={lv}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              aria-describedby={`${id}-${lv}`}
              onClick={() => onChange(lv)}
              onKeyDown={(e) => onKeyDown(e, i)}
              {...tipProps({ title: `추론 강도 · ${ASSISTANT_LEVEL_LABEL[lv]}`, lines: [ASSISTANT_LEVEL_HINT[lv]] })}
              className={`${TOOLBAR_SEG_ITEM} cursor-pointer ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              {ASSISTANT_LEVEL_LABEL[lv]}
            </button>
          );
        })}
      </div>
      {ASSISTANT_LEVELS.map((lv) => (
        <span key={lv} id={`${id}-${lv}`} hidden>
          {ASSISTANT_LEVEL_HINT[lv]}
        </span>
      ))}
    </div>
  );
}
